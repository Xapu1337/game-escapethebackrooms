import * as path from 'path';

export const GAME_ID = 'escapethebackrooms';
export const EXECUTABLE = "Backrooms.exe"; // path to executable, relative to game root
//export const EPIC_ID = ""; // removed as escape the backrooms is not on epic games
export const STEAM_ID = "1943950";


export const MODSFOLDER_PATH = path.join("EscapeTheBackrooms", "Content", "Paks", "~mods"); // relative to game root
export const MOVIESMOD_PATH = path.join("EscapeTheBackrooms", "Content"); // relative to game root, can't be /movies as we need to add pak files too sometimes

export const MOVIES_EXTENSION = ".bk2";
export const PAK_EXTENSIONS = [".pak", ".utoc", ".ucas"];
export const IGNORE_CONFLICTS = ["ue4sslogicmod.info", ".ue4sslogicmod", ".logicmod"];
export const IGNORE_DEPLOY = [path.join('**', 'enabled.txt')];
export const STOP_PATTERNS = ["[^/]*\\.pak$"];