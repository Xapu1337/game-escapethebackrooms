import { types } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, MODSFOLDER_PATH, MODTYPE_MOVIES } from '../common';
import { getLoadOrder, prefixForMod } from '../util/loadOrderPrefix';

const ETBPAKModType = { isSupported: (g: string) => g === GAME_ID, getPath, test: detect, options: { mergeMods: merge, name: 'PAK Mod' } };

function getPath(context: types.IExtensionContext, game: types.IGame): string | undefined {
  const st: types.IState = context.api.getState();
  const gp: string | undefined = st.settings.gameMode.discovered?.[game.id]?.path;
  return gp ? path.join(gp, MODSFOLDER_PATH) : undefined;
}

async function detect(instructions: types.IInstruction[]): Promise<boolean> {
  const copies = instructions.filter(i => i.type === 'copy');
  const pakCopies = copies.filter(i => i.source && path.extname(i.source) === '.pak');
  if (!pakCopies.length) return false;
  const excluded = copies.find(i => {
    const s = i.source?.toLowerCase();
    return s?.endsWith('.lua') || s?.endsWith('ue4sslogicmod.info') || s?.endsWith('.ue4sslogicmod') || s?.endsWith('.logicmod');
  });
  if (excluded) return false;
  // Exclude mods already routed to LogicMods by the BP/Lua installer
  const targetsLogicMods = copies.some(i => i.destination?.toLowerCase().includes('logicmods'));
  return !targetsLogicMods;
}

function merge(mod: types.IMod, context: types.IExtensionContext): string {
  if (mod.type === MODTYPE_MOVIES) return '';
  const prefix = prefixForMod(getLoadOrder(context.api, GAME_ID), mod.id);
  return prefix + '-' + mod.id;
}

export default ETBPAKModType;
