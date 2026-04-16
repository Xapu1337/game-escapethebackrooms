import { types } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, IGNORE_CONFLICTS } from '../common';

const LOGICMODS_PATH = path.join('EscapeTheBackrooms', 'Content', 'Paks', 'LogicMods');

const ETBLogicModsModType = { isSupported: (g: string) => g === GAME_ID, getPath, test, options: { mergeMods: true, name: 'Blueprint Mod (LogicMods)' } };

function getPath(context: types.IExtensionContext, game: types.IGame): string | undefined {
  const st: types.IState = context.api.getState();
  const gp: string | undefined = st.settings.gameMode.discovered?.[game.id]?.path;
  return gp ? path.join(gp, LOGICMODS_PATH) : undefined;
}

async function test(instructions: types.IInstruction[]): Promise<boolean> {
  const copies = instructions.filter(i => i.type === 'copy');
  // Auto-detect when marker files are present alongside .pak files
  const hasMarker = copies.some(i => {
    const s = i.source?.toLowerCase();
    return IGNORE_CONFLICTS.some(m => s?.endsWith(m));
  });
  const hasPak = copies.some(i => i.source && path.extname(i.source).toLowerCase() === '.pak');
  if (hasMarker && hasPak) return true;
  // Also match when installer explicitly targeted LogicMods path
  const targetsLogicMods = copies.some(i =>
    i.destination?.toLowerCase().includes('logicmods')
  );
  return targetsLogicMods;
}

export default ETBLogicModsModType;
