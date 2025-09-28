import { fs, log, types, util } from 'vortex-api';
import * as path from 'path';
import * as https from 'https';
import { GAME_ID, UE4SS_GITHUB_API, UE4SS_CORE_DLL, UE4SS_FOLDER } from '../common';

interface IUE4SSReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface IUE4SSGitHubRelease {
    tag_name: string;
    assets: IUE4SSReleaseAsset[];
}

/**
 * Very small helper to pull the latest UE4SS release zip and place it in the game root if missing.
 * This intentionally avoids complex dependency management. 
 */
export async function installOrUpdateUE4SS(context: types.IExtensionContext, force: boolean = false, overrideVersion?: string): Promise<void> {
    const state = context.api.getState();
    const gamePath: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) return Promise.reject('Game path not discovered');

    const binPath = path.join(gamePath, 'EscapeTheBackrooms', 'Binaries', 'Win64');
    const targetDLL = path.join(binPath, UE4SS_CORE_DLL);
    const dwmapiDLL = path.join(binPath, 'dwmapi.dll');
    const ue4ssFolder = path.join(binPath, UE4SS_FOLDER);
    const versionFile = path.join(binPath, 'UE4SS.version');

    const exists = await anyExists([targetDLL, dwmapiDLL, ue4ssFolder]);
    if (exists) log('info', 'UE4SS already present – proceeding with update/repair');

    let release: IUE4SSGitHubRelease;
    try { release = await httpGetJSON(UE4SS_GITHUB_API); } catch (e) { return Promise.reject('Failed fetching UE4SS release metadata: ' + (e as Error).message); }
    const asset = release.assets.find(a => a.name.toLowerCase().endsWith('.zip'));
    if (!asset) return Promise.reject('No UE4SS zip asset found in latest release');

    // Skip download if version file already matches tag and core dll exists, unless forced
    if (!force) {
        try {
            if (exists) {
                const vContent = await fs.readFileAsync(versionFile, 'utf8').catch(() => undefined);
                if (vContent && vContent.trim() === release.tag_name) {
                    context.api?.sendNotification?.({ type: 'success', message: `UE4SS already up to date (${release.tag_name})` });
                    return Promise.resolve();
                }
            }
        } catch { /* ignore */ }
    }

    await fs.ensureDirWritableAsync(binPath).catch(() => undefined);

    // Use a unique temp file to avoid contention (previous static name caused occasional EPERM in some environments)
    const tmpBase = util.getVortexPath('temp');
    const zipPath = path.join(
        tmpBase,
        `ue4ss_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`
    );
    context.api?.sendNotification?.({ type: 'info', message: `${exists ? 'Updating' : 'Installing'} UE4SS ${release.tag_name}` });
    try { await downloadWithRetry(asset.browser_download_url, zipPath, 3); } catch (e) { return Promise.reject('Failed downloading UE4SS: ' + (e as Error).message); }


    try {
        const stat = await fs.statAsync(zipPath);
        if (stat.size < 50 * 1024) { await safeUnlink(zipPath); return Promise.reject('Downloaded UE4SS archive too small – aborting'); }
    } catch (e) { return Promise.reject('Unable to validate UE4SS archive: ' + (e as Error).message); }

    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(binPath, true);
        try {
            const entries: string[] = await fs.readdirAsync(binPath).catch(() => [] as string[]);
            for (const e of entries) {
                if (e.toLowerCase().endsWith('.md')) {
                    try { await fs.unlinkAsync(path.join(binPath, e)); } catch { /* ignore */ }
                }
            }
        } catch { /* ignore listing errors */ }
    } catch (err) {
        await safeUnlink(zipPath).catch(() => undefined);
        log('error', 'Failed extracting UE4SS', err);
        return Promise.reject(err);
    }

    await safeUnlink(zipPath).catch(() => undefined);
    // Write version file so we can skip redundant updates later
    const storedVersion = overrideVersion ? overrideVersion : release.tag_name;
    try { await fs.writeFileAsync(versionFile, storedVersion, 'utf8').catch(() => undefined); } catch { /* ignore */ }
    context.api?.sendNotification?.({ type: 'success', message: `UE4SS ${exists ? 'updated' : 'installed'} to Binaries/Win64` });
    return Promise.resolve();
}

export async function uninstallUE4SS(context: types.IExtensionContext): Promise<void> {
    const state = context.api.getState();
    const gamePath: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) return Promise.reject('Game path not discovered');
    const binPath = path.join(gamePath, 'EscapeTheBackrooms', 'Binaries', 'Win64');
    const targets = [
        path.join(binPath, UE4SS_CORE_DLL),
        path.join(binPath, 'dwmapi.dll'),
        path.join(binPath, 'README.md'),
        path.join(binPath, 'readme.md'),
        path.join(binPath, 'Changelog.md'),
        path.join(binPath, 'changelog.md'),
        path.join(binPath, 'UE4SS-settings.ini'),
        path.join(binPath, 'UE4SS.version'),
        path.join(binPath, 'Mods'), // in case present
        path.join(binPath, UE4SS_FOLDER),
    ];
    for (const t of targets) {
        try {
            const stats = await fs.statAsync(t).catch(() => undefined);
            if (!stats) continue;
            if ((stats as any).isDirectory?.()) await fs.removeAsync?.(t).catch(async () => { /* fallback */ });
            else await fs.unlinkAsync(t).catch(() => undefined);
        } catch { /* ignore individual */ }
    }
    context.api?.sendNotification?.({ type: 'success', message: 'UE4SS uninstalled' });
}

export function isUE4SSInstalledSync(context: types.IExtensionContext): boolean {
    try {
        const state = context.api.getState();
        const gp: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
        if (!gp) return false;
        const fsNative = require('fs');
        const binPath = path.join(gp, 'EscapeTheBackrooms', 'Binaries', 'Win64');
        return [UE4SS_CORE_DLL, 'dwmapi.dll', UE4SS_FOLDER].some(f => fsNative.existsSync(path.join(binPath, f)));
    } catch { return false; }
}

export function getUE4SSVersionSync(context: types.IExtensionContext): string | undefined {
    try {
        const state = context.api.getState();
        const gp: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
        if (!gp) return undefined;
        const fsNative = require('fs');
        const binPath = path.join(gp, 'EscapeTheBackrooms', 'Binaries', 'Win64');
        const vf = path.join(binPath, 'UE4SS.version');
        if (!fsNative.existsSync(vf)) return undefined;
        return fsNative.readFileSync(vf, 'utf8').trim();
    } catch { return undefined; }
}


function httpGetJSON<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'vortex-etb-extension' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // redirect
                return resolve(httpGetJSON<T>(res.headers.location));
            }
            if (res.statusCode !== 200) {
                return reject(new Error('HTTP ' + res.statusCode));
            }
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('end', () => {
                try {
                    const merged = Buffer.concat(chunks as any);
                    const json = JSON.parse(merged.toString('utf8')) as T;
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function downloadWithRetry(url: string, dest: string, attempts: number): Promise<void> {
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
        try { await downloadFile(url, dest); return; } catch (e) { lastErr = e; await safeUnlink(dest).catch(() => undefined); if (i < attempts) await delay(750 * i); }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Unknown download error');
}

function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const fsNative = require('fs');
        let out: any;
        try {
            out = fsNative.createWriteStream(dest);
        } catch (e: any) {
            if (e?.code === 'EPERM' || e?.code === 'EACCES') {
                // Fallback to OS temp dir
                try {
                    const os = require('os');
                    const alt = require('path').join(os.tmpdir(), require('path').basename(dest));
                    out = fsNative.createWriteStream(alt);
                    dest = alt; // reassign so caller validates the right file
                } catch (inner) {
                    return reject(e);
                }
            } else {
                return reject(e);
            }
        }
        let finished = false;
        const req = https.get(url, { headers: { 'User-Agent': 'vortex-etb-extension' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.destroy();
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) { return reject(new Error('HTTP ' + res.statusCode)); }
            res.pipe(out);
            out.on('finish', () => { finished = true; out.close(() => resolve()); });
        });
        req.on('error', (err) => {
            if (!finished) {
                try { out.close(); } catch { /* ignore */ }
                reject(err);
            }
        });
    });
}

async function anyExists(paths: string[]): Promise<boolean> { for (const p of paths) { try { await fs.statAsync(p); return true; } catch { /* ignore */ } } return false; }
async function safeUnlink(p: string): Promise<void> { try { await fs.unlinkAsync(p); } catch { /* ignore */ } }
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export default installOrUpdateUE4SS;