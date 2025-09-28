import { types, util, selectors } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, MODSFOLDER_PATH, MODTYPE_MOVIES } from '../common';
import { IProps } from '../types';

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
  return !excluded;
}

function merge(mod: types.IMod, context: types.IExtensionContext): string {
  const props = getProps(context);
  if (!props) return 'ZZZZ-' + mod.id;
  const loadOrder = util.getSafe(props.state, ['persistent','loadOrder', props.profile.id], []);
  const idx = loadOrder.findIndex((lo: any) => lo.id === mod.id);
  if (mod.type === MODTYPE_MOVIES) return '';
  const prefix = makePrefix(idx);
  return prefix ? prefix + '-' + mod.id : 'ZZZZ-' + mod.id;
}

function makePrefix(input: number): string {
  let res = ''; let rest = input;
  while (rest > 0) { res = String.fromCharCode(65 + (rest % 25)) + res; rest = Math.floor(rest / 25); }
  return util.pad(res as any, 'A', 3);
}

function getProps(context: types.IExtensionContext, profileId?: string): IProps | undefined {
  const api = context.api; const state = api.getState();
  const profile: types.IProfile = profileId ? selectors.profileById(state, profileId) : selectors.activeProfile(state);
  if (profile?.gameId !== GAME_ID) return undefined;
  const discovery = util.getSafe(state, ['settings','gameMode','discovered', GAME_ID], undefined) as types.IDiscoveryResult | undefined;
  if (!discovery || !discovery.path) return undefined;
  const mods = util.getSafe(state, ['persistent','mods', GAME_ID], {});
  return { api, state, profile, mods, discovery };
}

export default ETBPAKModType;
