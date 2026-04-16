import { fs, log, types, util } from 'vortex-api';
import * as path from 'path';
import * as https from 'https';
import {
    GAME_ID, UE4SS_GITHUB_API, UE4SS_CORE_DLL, UE4SS_FOLDER,
    UE4SS_GITHUB_RELEASES_API, ETB_UE4SS_GITHUB_API,
    ETB_UE4SS_NEXUS_MOD_ID, INTERPOSE_NEXUS_MOD_ID,
} from '../common';

export interface IUE4SSReleaseAsset {
    name: string;
    browser_download_url: string;
}

export interface IUE4SSGitHubRelease {
    tag_name: string;
    assets: IUE4SSReleaseAsset[];
}

// ── Release cache (5-min TTL to avoid GitHub rate limiting) ──

let _releaseCache: { releases: IUE4SSGitHubRelease[]; timestamp: number } | undefined;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Standard UE4SS install (latest) ──

export async function installOrUpdateUE4SS(context: types.IExtensionContext, force: boolean = false, overrideVersion?: string): Promise<void> {
    let release: IUE4SSGitHubRelease;
    try { release = await httpGetJSON(UE4SS_GITHUB_API); } catch (e) { return Promise.reject('Failed fetching UE4SS release metadata: ' + (e as Error).message); }
    return _doInstallUE4SS(context, release, force, overrideVersion);
}

// ── Install a specific release (picked from version list) ──

export async function installSpecificUE4SSRelease(context: types.IExtensionContext, release: IUE4SSGitHubRelease): Promise<void> {
    return _doInstallUE4SS(context, release, true);
}

// ── Shared install logic ──

async function _doInstallUE4SS(context: types.IExtensionContext, release: IUE4SSGitHubRelease, force: boolean = false, overrideVersion?: string): Promise<void> {
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

    const asset = release.assets.find(a => a.name.toLowerCase().endsWith('.zip'));
    if (!asset) return Promise.reject('No UE4SS zip asset found in release ' + release.tag_name);

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

    const tmpBase = util.getVortexPath('temp');
    const zipPath = path.join(tmpBase, `ue4ss_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`);
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
    const storedVersion = overrideVersion ? overrideVersion : release.tag_name;
    try { await fs.writeFileAsync(versionFile, storedVersion, 'utf8').catch(() => undefined); } catch { /* ignore */ }
    context.api?.sendNotification?.({ type: 'success', message: `UE4SS ${exists ? 'updated' : 'installed'} to Binaries/Win64` });
}

// ── Fetch multiple releases for version picker ──

export async function fetchUE4SSReleases(maxCount: number = 10): Promise<IUE4SSGitHubRelease[]> {
    if (_releaseCache && (Date.now() - _releaseCache.timestamp) < CACHE_TTL_MS) {
        return _releaseCache.releases;
    }
    const releases: IUE4SSGitHubRelease[] = await httpGetJSON(
        UE4SS_GITHUB_RELEASES_API + '?per_page=' + maxCount
    );
    const filtered = releases.filter(r => r.assets.some(a => a.name.toLowerCase().endsWith('.zip')));
    _releaseCache = { releases: filtered, timestamp: Date.now() };
    return filtered;
}

// ── Uninstall standard UE4SS ──

export async function uninstallUE4SS(context: types.IExtensionContext): Promise<void> {
    const state = context.api.getState();
    const gamePath: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) return Promise.reject('Game path not discovered');
    const binPath = path.join(gamePath, 'EscapeTheBackrooms', 'Binaries', 'Win64');
    const targets = [
        path.join(binPath, UE4SS_CORE_DLL),
        path.join(binPath, 'dwmapi.dll'),
        path.join(binPath, 'README.md'),
        path.join(binPath, 'Changelog.md'),
        path.join(binPath, 'UE4SS-settings.ini'),
        path.join(binPath, 'UE4SS.version'),
        path.join(binPath, 'Mods'),
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
    context.api?.sendNotification?.({ type: 'success', message: 'Standard UE4SS uninstalled' });
}

// ── Detection helpers ──

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

// ── Vortex mod detection by Nexus mod ID ──

export function findModByNexusId(context: types.IExtensionContext, nexusModId: number): types.IMod | undefined {
    const state = context.api.getState();
    const mods: Record<string, types.IMod> = util.getSafe(state, ['persistent', 'mods', GAME_ID], {});
    return Object.values(mods).find(m =>
        m.attributes?.source === 'nexus' &&
        Number(m.attributes?.modId) === nexusModId
    );
}

export function isETBUE4SSInstalled(context: types.IExtensionContext): boolean {
    return findModByNexusId(context, ETB_UE4SS_NEXUS_MOD_ID) !== undefined;
}

export function isInterposeInstalled(context: types.IExtensionContext): boolean {
    return findModByNexusId(context, INTERPOSE_NEXUS_MOD_ID) !== undefined;
}

// ── Install ETB UE4SS (auto-download from GitHub, install as Vortex mod) ──

export async function installETBUE4SS(context: types.IExtensionContext): Promise<void> {
    let release: IUE4SSGitHubRelease;
    try {
        release = await httpGetJSON(ETB_UE4SS_GITHUB_API);
    } catch (e) {
        return Promise.reject('Failed fetching ETB UE4SS release: ' + (e as Error).message);
    }
    const asset = release.assets.find(a => a.name.toLowerCase().endsWith('.zip'));
    if (!asset) return Promise.reject('No zip asset found in ETB UE4SS release');

    context.api?.sendNotification?.({ type: 'info', message: `Downloading ETB UE4SS ${release.tag_name}...` });

    return new Promise<void>((resolve, reject) => {
        context.api.events.emit(
            'start-download',
            [asset.browser_download_url],
            {
                game: GAME_ID,
                name: 'ETB UE4SS',
                source: 'github',
            },
            `ETB_UE4SS_${release.tag_name}.zip`,
            (error: Error, id: string) => {
                if (error) {
                    log('error', 'ETB UE4SS download failed', error);
                    reject(error);
                    return;
                }
                log('info', 'ETB UE4SS download started', { id });
                context.api?.sendNotification?.({ type: 'success', message: 'ETB UE4SS download started. Install it from your Downloads tab.' });
                resolve();
            },
            'replace',
        );
    });
}

// ── Install Interpose (open Nexus page) ──

export function installInterpose(context: types.IExtensionContext): void {
    const url = `https://www.nexusmods.com/escapethebackrooms/mods/${INTERPOSE_NEXUS_MOD_ID}?tab=files`;
    util.opn(url);
    context.api?.sendNotification?.({
        type: 'info',
        message: 'Opening Nexus page for Interpose. Click "Mod Manager Download" to install via Vortex.',
    });
}

// ── Remove a Vortex mod by Nexus ID ──

export async function removeVortexMod(context: types.IExtensionContext, nexusModId: number, label: string): Promise<void> {
    const mod = findModByNexusId(context, nexusModId);
    if (!mod) return;
    try {
        await new Promise<void>((resolve, reject) => {
            context.api.events.emit('remove-mod', GAME_ID, mod.id, (error: Error) => {
                if (error) reject(error); else resolve();
            });
        });
        context.api?.sendNotification?.({ type: 'success', message: `${label} removed` });
    } catch (err) {
        log('error', `Failed to remove ${label}`, err);
        context.api?.sendNotification?.({ type: 'error', message: `Failed to remove ${label}` });
    }
}

// ── Network helpers ──

function httpGetJSON<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'vortex-etb-extension' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
                try {
                    const os = require('os');
                    const alt = require('path').join(os.tmpdir(), require('path').basename(dest));
                    out = fsNative.createWriteStream(alt);
                    dest = alt;
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
