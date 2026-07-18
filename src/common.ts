import * as path from 'path';

// ==== Game Identification ====
export const GAME_ID = 'escapethebackrooms';
export const EXECUTABLE = 'Backrooms.exe'; // path to executable, relative to game root
export const STEAM_ID = '1943950';

// ==== Standard Unreal (UE4 4.27) Paths for ETB ====
export const MODSFOLDER_PATH = path.join('EscapeTheBackrooms', 'Content', 'Paks', '~mods'); // relative to game root
export const MOVIESMOD_PATH = path.join('EscapeTheBackrooms', 'Content'); // root content folder (movies are in subfolders under Movies)

// ==== File Extensions / Patterns ====
export const MOVIES_EXTENSION = '.bk2';
export const PAK_EXTENSIONS = ['.pak', '.utoc', '.ucas'];
export const IGNORE_CONFLICTS = ['ue4sslogicmod.info', '.ue4sslogicmod', '.logicmod'];
export const IGNORE_DEPLOY = [path.join('**', 'enabled.txt')];
export const STOP_PATTERNS = ['[^/]*\\.pak$'];

// Internal IDs
export const MODTYPE_MOVIES = 'etb-modtype-movies';
export const MODTYPE_PAK = 'etb-modtype-pak';
export const MODTYPE_LOGICMODS = 'etb-modtype-logicmods';
export const INSTALLER_MOVIES = 'etb-installer-movies';
export const INSTALLER_BP_LUA = 'etb-installer-bp-lua';

// UE4SS expected markers
export const UE4SS_CORE_DLL = 'UE4SS.dll';
// The ETB UE4SS fork ships this folder lowercase on disk ('ue4ss'). Match it exactly
// so paths line up cross-platform and read the way they actually appear in the install
// (Windows is case-insensitive, but the code shouldn't imply a case that isn't there).
export const UE4SS_FOLDER = 'ue4ss';

// UE4SS mods subfolder (relative to Win64), e.g. Win64/ue4ss/Mods
export const UE4SS_MODS_SUBPATH = path.join(UE4SS_FOLDER, 'Mods');
// LogicMods folder (relative to game root)
export const LOGICMODS_PATH = path.join('EscapeTheBackrooms', 'Content', 'Paks', 'LogicMods');

export const UE4_VERSION = '4.27';
export const ETB_UE4SS_GITHUB_API = 'https://api.github.com/repos/ETBCommunity/UE4SS/releases/latest';

// Nexus mod IDs
export const INTERPOSE_NEXUS_MOD_ID = 7;