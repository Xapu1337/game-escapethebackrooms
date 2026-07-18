import { selectors, types, util } from 'vortex-api';

// Unreal mounts .pak files in alphabetical path order and the last one mounted wins
// conflicts, so a mod's load order index is encoded as a prefix that sorts the same way.

/** Prefix used when a mod can't be found in the load order, so it always sorts last. */
export const UNKNOWN_PREFIX = 'ZZZ';

/**
 * Encode a load order index as a 3-character base-25 letter prefix (AAA, AAB ... YYY).
 * Letters are used rather than digits for the larger range: 25^3 = 15,625 slots
 * versus 999 for a 3-digit number.
 *
 * 'Z' is deliberately never produced (digits map to A-Y) so that UNKNOWN_PREFIX
 * always sorts after any real entry.
 */
export function makePrefix(input: number): string {
  let res = '';
  let rest = input;
  while (rest > 0) {
    res = String.fromCharCode(65 + (rest % 25)) + res;
    rest = Math.floor(rest / 25);
  }
  return util.pad(res as any, 'A', 3);
}

/**
 * Resolve the load order for a game.
 *
 * Merges run as part of deployment, where `activeProfile` is not guaranteed to be
 * set, so fall back to the last active profile for the game rather than assuming
 * a profile is active (reading `.id` off an undefined profile throws and aborts
 * the whole deployment).
 */
export function getLoadOrder(api: types.IExtensionApi, gameId: string): Array<{ id?: string }> {
  const state = api.getState();
  const profileId: string | undefined =
    selectors.activeProfile(state)?.id ?? selectors.lastActiveProfileForGame(state, gameId);
  if (!profileId) return [];
  return (state as any).persistent?.loadOrder?.[profileId] ?? [];
}

/**
 * Prefix for a mod id based on its load order position. Mods missing from the load
 * order get UNKNOWN_PREFIX so they sort last instead of first.
 */
export function prefixForMod(loadOrder: Array<{ id?: string }>, modId: string): string {
  const idx = loadOrder.findIndex(lo => lo?.id === modId);
  return idx < 0 ? UNKNOWN_PREFIX : makePrefix(idx);
}
