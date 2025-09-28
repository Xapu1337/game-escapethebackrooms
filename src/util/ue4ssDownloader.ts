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
 * This intentionally avoids complex dependency management. User can re-run via action if needed.
 */
export async function ensureUE4SS(context: types.IExtensionContext): Promise<void> {
    const state = context.api.getState();
    const gamePath: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) return Promise.reject('Game path not discovered');

    const targetDLL = path.join(gamePath, UE4SS_CORE_DLL);
    const xinputDLL = path.join(gamePath, 'xinput1_3.dll');
    const ue4ssFolder = path.join(gamePath, UE4SS_FOLDER);

    // Detect existing install (either dll or UE4SS folder). If both exist, assume user customized; skip.
    const exists = await anyExists([targetDLL, xinputDLL, ue4ssFolder]);
    if (exists) {
        log('info', 'UE4SS appears present – skipping auto install');
        return Promise.resolve();
    }

    let release: IUE4SSGitHubRelease;
    try { release = await httpGetJSON(UE4SS_GITHUB_API); } catch (e) { return Promise.reject('Failed fetching UE4SS release metadata: ' + (e as Error).message); }
    const asset = release.assets.find(a => a.name.toLowerCase().endsWith('.zip'));
    if (!asset) return Promise.reject('No UE4SS zip asset found in latest release');

    const zipPath = path.join(util.getVortexPath('temp'), 'ue4ss_latest.zip');
    context.api?.sendNotification?.({ type: 'info', message: `Downloading UE4SS ${release.tag_name}` });
    try { await downloadWithRetry(asset.browser_download_url, zipPath, 3); } catch (e) { return Promise.reject('Failed downloading UE4SS: ' + (e as Error).message); }

    // Basic size sanity check (> 50KB)
    try {
        const stat = await fs.statAsync(zipPath);
        if (stat.size < 50 * 1024) { await safeUnlink(zipPath); return Promise.reject('Downloaded UE4SS archive too small – aborting'); }
    } catch (e) { return Promise.reject('Unable to validate UE4SS archive: ' + (e as Error).message); }

    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(gamePath, true);
    } catch (err) {
        await safeUnlink(zipPath).catch(() => undefined);
        log('error', 'Failed extracting UE4SS', err);
        return Promise.reject(err);
    }

    await safeUnlink(zipPath).catch(() => undefined);
    context.api?.sendNotification?.({ type: 'success', message: 'UE4SS installed' });
    return Promise.resolve();
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
        const out = require('fs').createWriteStream(dest);
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
        req.on('error', (err) => { if (!finished) { try { out.close(); } catch { /* ignore */ } reject(err); } });
    });
}

async function anyExists(paths: string[]): Promise<boolean> { for (const p of paths) { try { await fs.statAsync(p); return true; } catch { /* ignore */ } } return false; }
async function safeUnlink(p: string): Promise<void> { try { await fs.unlinkAsync(p); } catch { /* ignore */ } }
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export default ensureUE4SS;