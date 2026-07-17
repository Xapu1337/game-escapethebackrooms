import { types } from 'vortex-api';
import { GAME_ID } from '../common';

const ETBLogicModsModType = {
  isSupported: (g: string) => g === GAME_ID,
  getPath,
  test,
  options: { mergeMods: true, name: 'Blueprint Mod (LogicMods)' },
};

function getPath(context: types.IExtensionContext, game: types.IGame): string | undefined {
  const st: types.IState = context.api.getState();
  // Deploy relative to game root so full-path staging (EscapeTheBackrooms/Content/Paks/LogicMods/...)
  // lands correctly in LogicMods without path doubling
  return st.settings.gameMode.discovered?.[game.id]?.path;
}

async function test(_instructions: types.IInstruction[]): Promise<boolean> {
  return false;
}

export default ETBLogicModsModType;
