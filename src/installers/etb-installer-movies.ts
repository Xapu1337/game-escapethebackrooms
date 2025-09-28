import { fs, types } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, MOVIESMOD_PATH, MOVIES_EXTENSION, PAK_EXTENSIONS, MODTYPE_MOVIES } from '../common';

const ETBMovieInstaller = { test: detect, install };

async function detect(files: string[], gameId: string): Promise<types.ISupportedResult> {
  const hasMovie = files.some(f => path.extname(f).toLowerCase() === MOVIES_EXTENSION);
  return { supported: gameId === GAME_ID && hasMovie, requiredFiles: [] };
}

async function install(files: string[], context: types.IExtensionContext): Promise<types.IInstallResult> {
  const state = context.api.getState();
  const discovery = state.settings.gameMode?.discovered[GAME_ID];
  if (!discovery?.path) return Promise.reject('Game path not discovered');
  const rootPath = path.join(discovery.path, MOVIESMOD_PATH);
  const moviesRoot = path.join(discovery.path, MOVIESMOD_PATH, 'Movies');

  const fileList = files.filter(f => !f.endsWith(path.sep));
  const movieFiles = fileList.filter(f => path.extname(f).toLowerCase() === MOVIES_EXTENSION);
  const pakLike = fileList.filter(f => PAK_EXTENSIONS.includes(path.extname(f)));

  if (!movieFiles.length && !pakLike.length) return Promise.reject('No movie or PAK files detected');

  const existingMovieFiles = await enumerateFiles(moviesRoot, rootPath, true).catch(() => [] as string[]);
  const instructions: types.IInstruction[] = [{ type: 'setmodtype', value: MODTYPE_MOVIES }];

  for (const mf of movieFiles) {
    const target = existingMovieFiles.find(orig => path.basename(orig).toLowerCase() === path.basename(mf).toLowerCase());
    if (target) instructions.push({ type: 'copy', source: mf, destination: target });
  }

  for (const pf of pakLike) {
    instructions.push({ type: 'copy', source: pf, destination: path.join('Paks', '~mods', path.basename(pf)) });
  }

  if (instructions.length === 1) return Promise.reject('No valid install instructions resolved');
  return { instructions };
}

async function enumerateFiles(folder: string, relativeTo: string, recurse: boolean): Promise<string[]> {
  const out: string[] = [];
  let items: string[] = [];
  try { items = await fs.readdirAsync(folder); } catch { return out; }
  for (const item of items) {
    const abs = path.join(folder, item);
    try {
      if (await fs.isDirectoryAsync(abs)) {
        if (recurse) out.push(...await enumerateFiles(abs, relativeTo, recurse));
      } else {
        if (folder.includes(relativeTo)) {
          const rel = folder.substring(folder.indexOf(relativeTo) + relativeTo.length);
          out.push(path.join(rel, item));
        } else out.push(path.join(folder, item));
      }
    } catch { /* ignore individual item failure */ }
  }
  return out;
}

export default ETBMovieInstaller;
