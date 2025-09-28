import { types } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, MOVIESMOD_PATH } from '../common';

const ETBMoviesModType = { isSupported: (g: string) => g === GAME_ID, getPath, test, options: { mergeMods: true, name: 'Movie Replacer' } };

function getPath(context: types.IExtensionContext, game: types.IGame): string | undefined {
  const st: types.IState = context.api.getState();
  const gp: string | undefined = st.settings.gameMode.discovered?.[game.id]?.path;
  return gp ? path.join(gp, MOVIESMOD_PATH) : undefined;
}

async function test(): Promise<boolean> { return false; }

export default ETBMoviesModType;
