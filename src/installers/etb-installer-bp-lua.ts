import { types } from 'vortex-api';
import * as path from 'path';
import { GAME_ID, IGNORE_CONFLICTS, PAK_EXTENSIONS } from '../common';

const LUA_EXT = '.lua';
const LUA_PATH = path.join('EscapeTheBackrooms', 'Binaries', 'Win64', 'Mods');
// Use canonical 'Paks' casing (important on case-sensitive filesystems)
const LOGIC_PATH = path.join('EscapeTheBackrooms', 'Content', 'Paks', 'LogicMods');

const ETBBluePrintOrLuaInstaller = { test: detect, install };

async function detect(files: string[], gameId: string): Promise<types.ISupportedResult> {
  const relevant = files.filter(f => path.extname(f).toLowerCase() === LUA_EXT || IGNORE_CONFLICTS.includes(path.basename(f).toLowerCase()));
  return { supported: gameId === GAME_ID && relevant.length > 0, requiredFiles: [] };
}

async function install(files: string[]): Promise<types.IInstallResult> {
  // Accept only files that have an extension (skip directories)
  const cleaned = files.filter(f => !!path.extname(f));
  const pakFiles = cleaned.filter(f => PAK_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  const pakInstr = pakFiles.map(p => ({ type: 'copy', source: p, destination: path.join(LOGIC_PATH, path.basename(p)) }));

  const luaScriptFiles = cleaned.filter(f => f.toLowerCase().includes('scripts') && path.extname(f).toLowerCase() === LUA_EXT);
  const luaFolders = Array.from(new Set(luaScriptFiles.map(f => {
    const norm = f.split(/\\|\//); // support both separators in archives
    const scriptsIdx = norm.findIndex(p => p.toLowerCase() === 'scripts');
    if (scriptsIdx > 0) return norm[scriptsIdx - 1];
    return undefined;
  }).filter(Boolean)));

  const luaInstr = luaFolders.flatMap(folderName => {
    const folder = folderName as string;
    const modFiles = cleaned.filter(f => f.toLowerCase().includes(path.sep + folder.toLowerCase() + path.sep) || f.toLowerCase().includes('/' + folder.toLowerCase() + '/'));
    return modFiles.map(f => {
      const segments = f.split(/\\|\//);
      const idx = segments.findIndex(s => s.toLowerCase() === folder.toLowerCase());
      const tail = segments.slice(idx + 1).join(path.sep);
      return { type: 'copy', source: f, destination: path.join(LUA_PATH, folder, tail) } as types.IInstruction;
    });
  });

  const usedSources = new Set([...pakInstr, ...luaInstr].map(i => (i.source || '').toLowerCase()));
  const passthrough = cleaned.filter(f => !usedSources.has(f.toLowerCase())).map(f => ({ type: 'copy', source: f, destination: f } as types.IInstruction));
  const instructions: types.IInstruction[] = [...luaInstr as types.IInstruction[], ...pakInstr as types.IInstruction[], ...passthrough];
  if (!instructions.length) return Promise.reject('No valid Lua/Blueprint content detected');
  return { instructions };
}

export default ETBBluePrintOrLuaInstaller;
