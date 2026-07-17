import { fs, types, selectors } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, PAK_EXTENSIONS, MOVIES_EXTENSION, MODTYPE_MOVIES } from '../common';
import { getLoadOrder, prefixForMod } from '../util/loadOrderPrefix';

const ETBMovieMerger = { test: qualify, merge: doMerge, modtype: MODTYPE_MOVIES };

function qualify(context: types.IExtensionContext, game: types.IGame): types.IMergeFilter | undefined {
  if (game.id !== GAME_ID) return undefined;
  return { baseFiles: () => [], filter: (fp) => PAK_EXTENSIONS.includes(path.extname(fp)) };
}

async function doMerge(context: types.IExtensionContext, filePath: string, mergePath: string): Promise<void> {
  const state = context.api.getState();
  const installRoot: string = selectors.installPathForGame(state, GAME_ID);
  const relativeStaging = path.relative(installRoot, filePath);
  const modId = relativeStaging.split(path.sep)[0];
  const relPath = relativeStaging.split(path.sep).slice(1).join(path.sep);
  const target = path.join(mergePath, relPath);
  const prefix = prefixForMod(getLoadOrder(context.api, GAME_ID), modId);
  await fs.ensureDirWritableAsync(path.dirname(target), () => Promise.resolve());
  const ext = path.extname(filePath);
  if (ext === MOVIES_EXTENSION) {
    await fs.linkAsync(filePath, target);
    return;
  }
  if (PAK_EXTENSIONS.includes(ext)) {
    const prefixed = path.join(path.dirname(target), prefix + '-' + modId, path.basename(target));
    await fs.ensureDirWritableAsync(path.dirname(prefixed), () => Promise.resolve());
    await fs.linkAsync(filePath, prefixed);
    return;
  }
  return Promise.reject('Unsupported file encountered in merge pass');
}

export default ETBMovieMerger;
