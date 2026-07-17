import { actions, fs, log, selectors, types, util } from 'vortex-api';
import * as path from 'path';
import * as https from 'https';
import {
    GAME_ID, UE4SS_CORE_DLL, UE4SS_FOLDER, UE4SS_MODS_SUBPATH,
    ETB_UE4SS_GITHUB_API, INTERPOSE_NEXUS_MOD_ID,
} from '../common';

export interface IUE4SSReleaseAsset {
    name: string;
    browser_download_url: string;
}

export interface IUE4SSGitHubRelease {
    tag_name: string;
    assets: IUE4SSReleaseAsset[];
}


export function isUE4SSInstalledSync(context: types.IExtensionContext): boolean {
    try {
        const state = context.api.getState();
        const gp: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
        if (!gp) return false;
        const fsNative = require('fs');
        const binPath = path.join(gp, 'EscapeTheBackrooms', 'Binaries', 'Win64');
        return [UE4SS_CORE_DLL, 'dwmapi.dll', UE4SS_FOLDER].some(f => fsNative.existsSync(path.join(binPath, f)));
    } catch (e) {
        log('error', 'isUE4SSInstalledSync failed', e);
        return false;
    }
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
    } catch (e) {
        log('error', 'getUE4SSVersionSync failed', e);
        return undefined;
    }
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

export function isInterposeInstalled(context: types.IExtensionContext): boolean {
    return findModByNexusId(context, INTERPOSE_NEXUS_MOD_ID) !== undefined;
}


export async function installETBUE4SS(context: types.IExtensionContext): Promise<void> {
    let release: IUE4SSGitHubRelease;
    try {
        release = await httpGetJSON(ETB_UE4SS_GITHUB_API);
    } catch (e) {
        return Promise.reject('Failed fetching ETB UE4SS release: ' + (e as Error).message);
    }
    // Prefer the non-dev zip (skip zDev-* assets)
    const asset =
        release.assets.find(a => {
            const n = a.name.toLowerCase();
            return n.endsWith('.zip') && !n.startsWith('zdev');
        }) ?? release.assets.find(a => a.name.toLowerCase().endsWith('.zip'));
    if (!asset) return Promise.reject('No zip asset found in ETB UE4SS release');

    const state = context.api.getState();
    const gamePath: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) return Promise.reject('Game path not discovered');

    const binPath = path.join(gamePath, 'EscapeTheBackrooms', 'Binaries', 'Win64');
    const versionFile = path.join(binPath, 'UE4SS.version');

    const alreadyInstalled = isUE4SSInstalledSync(context);
    if (alreadyInstalled) {
        try {
            const vContent = await fs.readFileAsync(versionFile, 'utf8').catch((e: unknown) => {
                log('warn', 'Could not read UE4SS.version', e);
                return undefined;
            });
            if (vContent && vContent.trim() === release.tag_name) {
                context.api?.sendNotification?.({ type: 'success', message: `ETB UE4SS already up to date (${release.tag_name})` });
                return;
            }
        } catch (e) {
            log('warn', 'Version check failed, proceeding with install', e);
        }
    }

    try {
        await fs.ensureDirWritableAsync(binPath);
    } catch (e) {
        log('warn', 'ensureDirWritable failed for binPath', { binPath, e });
    }

    const tmpBase = util.getVortexPath('temp');
    const zipPath = path.join(tmpBase, `etb_ue4ss_${Date.now()}.zip`);
    context.api?.sendNotification?.({ type: 'info', message: `${alreadyInstalled ? 'Updating' : 'Installing'} ETB UE4SS ${release.tag_name}...` });

    try { await downloadWithRetry(asset.browser_download_url, zipPath, 3); }
    catch (e) { return Promise.reject('Failed downloading ETB UE4SS: ' + (e as Error).message); }

    try {
        const stat = await fs.statAsync(zipPath);
        if (stat.size < 50 * 1024) {
            await safeUnlink(zipPath);
            return Promise.reject('Downloaded archive too small, aborting');
        }
    } catch (e) { return Promise.reject('Unable to validate archive: ' + (e as Error).message); }

    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(binPath, true);

        // Remove stray .md files from Win64 root
        let entries: string[] = [];
        try {
            entries = await fs.readdirAsync(binPath);
        } catch (e) {
            log('warn', 'Could not list binPath after extraction', { binPath, e });
        }
        for (const e of entries) {
            if (e.toLowerCase().endsWith('.md')) {
                try {
                    await fs.unlinkAsync(path.join(binPath, e));
                } catch (err) {
                    log('warn', 'Could not remove stray .md file', { file: e, err });
                }
            }
        }
    } catch (err) {
        await safeUnlink(zipPath);
        log('error', 'Failed extracting ETB UE4SS', err);
        return Promise.reject('Failed extracting ETB UE4SS: ' + err);
    }

    await safeUnlink(zipPath);

    // Ensure UE4SS/Mods folder exists after extraction
    const modsPath = path.join(binPath, UE4SS_MODS_SUBPATH);
    try {
        await fs.ensureDirWritableAsync(modsPath);
    } catch (e) {
        log('warn', 'ensureDirWritable failed for modsPath', { modsPath, e });
    }

    const modsTxt = path.join(modsPath, 'Mods.txt');
    const txtExists = await fs.statAsync(modsTxt).then(() => true).catch((e: unknown) => {
        log('debug', 'Mods.txt not found, will create', e);
        return false;
    });
    if (!txtExists) {
        try {
            await fs.writeFileAsync(modsTxt, '; Created by Vortex\n', { encoding: 'utf8' });
        } catch (e) {
            log('warn', 'Could not create Mods.txt', { modsTxt, e });
        }
    }

    try {
        await fs.writeFileAsync(versionFile, release.tag_name, 'utf8');
    } catch (e) {
        log('warn', 'Could not write UE4SS.version', { versionFile, e });
    }

    context.api?.sendNotification?.({ type: 'success', message: `ETB UE4SS ${alreadyInstalled ? 'updated' : 'installed'} to Binaries/Win64 (${release.tag_name})` });
}


export async function uninstallETBUE4SS(context: types.IExtensionContext): Promise<void> {
    const state = context.api.getState();
    const gamePath: string | undefined = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) return Promise.reject('Game path not discovered');
    const binPath = path.join(gamePath, 'EscapeTheBackrooms', 'Binaries', 'Win64');
    const targets = [
        path.join(binPath, UE4SS_CORE_DLL),
        path.join(binPath, 'dwmapi.dll'),
        path.join(binPath, 'UE4SS-settings.ini'),
        path.join(binPath, 'UE4SS.version'),
        path.join(binPath, UE4SS_FOLDER),
    ];
    for (const t of targets) {
        try {
            const stats = await fs.statAsync(t).catch(() => {
                log('debug', 'uninstall target not present, skipping', t);
                return undefined;
            });
            if (!stats) continue;
            if ((stats as any).isDirectory?.()) {
                try {
                    await (fs as any).removeAsync?.(t);
                } catch (e) {
                    log('error', 'Failed to remove UE4SS directory', { t, e });
                }
            } else {
                try {
                    await fs.unlinkAsync(t);
                } catch (e) {
                    log('error', 'Failed to unlink UE4SS file', { t, e });
                }
            }
        } catch (e) {
            log('error', 'Unexpected error uninstalling UE4SS target', { t, e });
        }
    }
    context.api?.sendNotification?.({ type: 'success', message: 'ETB UE4SS uninstalled from Binaries/Win64' });
}

// ── Install / update Interpose via Vortex Nexus API (context.api.ext) ──

async function getLatestInterposeFile(context: types.IExtensionContext): Promise<{ fileId: number; version: string } | undefined> {
    const ext = (context.api as any).ext;
    if (!ext?.nexusGetModFiles) return undefined;
    try {
        const files = await ext.nexusGetModFiles(GAME_ID, INTERPOSE_NEXUS_MOD_ID);
        if (!files?.length) return undefined;
        const picked = files.find((f: any) => f.category_name === 'MAIN') ?? files[0];
        return { fileId: Number(picked.file_id), version: String(picked.version || picked.mod_version || '?') };
    } catch (e) {
        log('warn', '[interpose] could not fetch file list from Nexus', e);
        return undefined;
    }
}

export async function installInterpose(context: types.IExtensionContext, options?: { silent?: boolean }): Promise<void> {
    const existing = findModByNexusId(context, INTERPOSE_NEXUS_MOD_ID);
    const latest = await getLatestInterposeFile(context);

    if (existing && latest) {
        const installedFileId = Number(existing.attributes?.fileId);
        if (installedFileId === latest.fileId) {
            if (!options?.silent) {
                context.api?.sendNotification?.({ type: 'success', message: `Interpose ${latest.version} — newest version already installed` });
            }
            return;
        }
        context.api?.sendNotification?.({ type: 'info', message: `Updating Interpose to ${latest.version}...` });
    }

    const ext = (context.api as any).ext;
    if (!ext?.nexusDownload) {
        return Promise.reject('Nexus API not available, make sure you are logged in to Nexus Mods in Vortex.');
    }

    // Subscribe BEFORE triggering install so we don't miss the event
    const installDone = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 120_000);
        context.api.events.once('did-install-mod', (_gId: string, _archiveId: string, modId: string) => {
            clearTimeout(timer);
            resolve(modId);
        });
    });

    // Find a finished download for the specific latest version; fall back to any finished download.
    // Passing fileId avoids re-installing an outdated archive when we need to update.
    const existingDlId = findFinishedDownload(context, INTERPOSE_NEXUS_MOD_ID, latest?.fileId);
    if (existingDlId) {
        log('debug', '[interpose] installing from existing finished download', { existingDlId });
        if (!existing) context.api?.sendNotification?.({ type: 'info', message: 'Installing Interpose...' });
        context.api.events.emit('start-install-download', existingDlId, { allowAutoEnable: false }, (err: Error) => {
            if (err) log('warn', '[interpose] start-install-download callback error', err);
        });
    } else {
        if (!latest) {
            return Promise.reject('Could not determine latest Interpose version — check Nexus login');
        }
        if (!existing) context.api?.sendNotification?.({ type: 'info', message: `Downloading Interpose ${latest.version}...` });
        try {
            await ext.nexusDownload(GAME_ID, INTERPOSE_NEXUS_MOD_ID, latest.fileId, undefined, true);
        } catch (e) {
            return Promise.reject('Interpose download failed: ' + (e as Error).message);
        }
    }

    try {
        const newModId = await installDone;
        // Remove the previous version now that the new one is staged
        if (existing && existing.id !== newModId) {
            try {
                await new Promise<void>((resolve, reject) => {
                    context.api.events.emit('remove-mod', GAME_ID, existing.id, (err: Error) => {
                        if (err) reject(err); else resolve();
                    });
                });
                log('debug', '[interpose] removed old version', { oldModId: existing.id });
            } catch (e) {
                log('warn', '[interpose] could not remove old version', e);
            }
        }
        await enableAndDeployMod(context, newModId);
        const vStr = latest?.version ? ` ${latest.version}` : '';
        context.api?.sendNotification?.({ type: 'success', message: `Interpose${vStr} installed and enabled` });
    } catch (e) {
        log('warn', '[interpose] could not auto-enable after install', e);
        context.api?.sendNotification?.({ type: 'info', message: 'Interpose installed — enable it in the Mods list once it finishes' });
    }
}

// Background version check called on gamemode activation. Shows a warning notification
// with an "Update Now" button if the installed version is behind Nexus.
export async function checkInterposeOutdated(context: types.IExtensionContext): Promise<void> {
    const existing = findModByNexusId(context, INTERPOSE_NEXUS_MOD_ID);
    if (!existing) return;
    const latest = await getLatestInterposeFile(context);
    if (!latest) return;
    const installedFileId = Number(existing.attributes?.fileId);
    if (installedFileId === latest.fileId) return;
    const installedVersion = String(existing.attributes?.version || existing.attributes?.fileVersion || 'unknown');
    log('info', '[interpose] update available', { installedFileId, latestFileId: latest.fileId, latestVersion: latest.version });
    context.api?.sendNotification?.({
        type: 'warning',
        message: `Interpose update available: ${installedVersion} → ${latest.version}`,
        actions: [
            {
                title: 'Update Now',
                action: (dismiss: () => void) => {
                    dismiss();
                    installInterpose(context).catch(e => log('error', '[interpose] update failed', e));
                },
            },
        ],
    } as any);
}

function findFinishedDownload(context: types.IExtensionContext, nexusModId: number, fileId?: number): string | undefined {
    const state = context.api.getState();
    const downloads: Record<string, any> = util.getSafe(state, ['persistent', 'downloads', 'files'], {});
    const entry = Object.entries(downloads).find(([, dl]) => {
        if (Number(dl.modInfo?.nexus?.ids?.modId) !== nexusModId) return false;
        if (dl.state !== 'finished') return false;
        if (fileId !== undefined && Number(dl.modInfo?.nexus?.ids?.fileId) !== fileId) return false;
        return true;
    });
    return entry?.[0];
}

async function enableAndDeployMod(context: types.IExtensionContext, modId: string): Promise<void> {
    const state = context.api.getState();
    const profileId = selectors.activeProfile(state)?.id;
    if (!profileId) return;
    context.api.store?.dispatch(actions.setModEnabled(profileId, modId, true));
    await new Promise<void>((resolve, reject) => {
        context.api.events.emit('deploy-mods', (err: Error) => {
            if (err) reject(err); else resolve();
        });
    });
}


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
        try { await downloadFile(url, dest); return; } catch (e) {
            lastErr = e;
            log('warn', `Download attempt ${i}/${attempts} failed`, { url, e });
            await safeUnlink(dest);
            if (i < attempts) await delay(750 * i);
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Unknown download error');
}

function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const fsNative = require('fs');
        let out: any;
        try { out = fsNative.createWriteStream(dest); } catch (e: any) { return reject(e); }
        let finished = false;
        const req = https.get(url, { headers: { 'User-Agent': 'vortex-etb-extension' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.destroy(); return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) { return reject(new Error('HTTP ' + res.statusCode)); }
            res.pipe(out);
            out.on('finish', () => { finished = true; out.close(() => resolve()); });
        });
        req.on('error', (err) => {
            if (!finished) {
                try { out.close(); } catch (closeErr) { log('warn', 'Could not close write stream on request error', closeErr); }
                reject(err);
            }
        });
    });
}

async function safeUnlink(p: string): Promise<void> {
    try {
        await fs.unlinkAsync(p);
    } catch (e) {
        log('debug', 'safeUnlink: could not delete file', { p, e });
    }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
