import path from 'path';
import { actions, fs, log, selectors, types, util } from 'vortex-api';
import * as VortexUtils from './VortexUtils';
import { ILoadOrderEntry, IProps } from './types';
import { LuaModsMonitor, refreshLuaMods, writeManifest } from './util/luaModsUtil';
import { writeBPModLoadOrder, cleanupStaleLogicModPaks } from './util/bpModLoaderUtil';
import LuaModsLoadOrderPage from './views/LuaModsLoadOrderPage';
import { luaModReducer } from './reducers/luaReducer';

// IDs for different stores and nexus
import {
  STEAM_ID,
  GAME_ID,
  EXECUTABLE,
  MODSFOLDER_PATH,
  MOVIESMOD_PATH,
  LOGICMODS_PATH,
  UE4SS_MODS_SUBPATH,
  IGNORE_CONFLICTS,
  IGNORE_DEPLOY,
  STOP_PATTERNS,
  MODTYPE_MOVIES,
  MODTYPE_PAK,
  MODTYPE_LOGICMODS,
  INSTALLER_MOVIES,
  INSTALLER_BP_LUA,
  INTERPOSE_NEXUS_MOD_ID,
} from './common';
import {
  isUE4SSInstalledSync, getUE4SSVersionSync,
  isInterposeInstalled,
  installETBUE4SS, uninstallETBUE4SS, installInterpose,
  checkInterposeOutdated,
  removeVortexMod,
} from './util/ue4ssDownloader';
import ETBMovieInstaller from './installers/etb-installer-movies';
import ETBBluePrintOrLuaInstaller from './installers/etb-installer-bp-lua';
import ETBMoviesModType from './modtypes/etb-modtype-movies';
import ETBPAKModType from './modtypes/etb-modtype-pak';
import ETBLogicModsModType from './modtypes/etb-modtype-logicmods';
import ETBMovieMerger from './merges/etb-movies-merge';

let monitor: LuaModsMonitor;

const LOADORDER_FILE = 'loadOrder.json';
const VERSION_PATH = path.join('EscapeTheBackrooms', 'Content', 'Data', 'Version', 'DA_Version.txt');
let sessionModLoaderNotified = false;
let sessionModLoaderSuppressed = false;
let modLoaderNotificationId: string | undefined;

async function getGameVersion(discoveryPath: string) {
  // Try both with and without the extra game folder in case discovery already points at the project folder
  const candidates = [
    path.join(discoveryPath, VERSION_PATH),
    path.join(discoveryPath, 'Content', 'Data', 'Version', 'DA_Version.txt'),
  ];
  for (const fp of candidates) {
    try {
      const contents = await fs.readFileAsync(fp, { encoding: 'utf8' });
      if (contents) return contents.trim();
    } catch { /* try next */ }
  }
  return 'unknown';
}

// async function OnWillDeploy(
//   context: IExtensionContext,
//   willDeployEventArgs: WillDeployEventArgs,
// ) {
//   const state = context.api.getState();
//   const profile: types.IProfile = selectors.activeProfile(state);

//   /*
//   // console.log("OnWillDeploy");
//   // console.log(context);
//   // console.log(willDeployEventArgs);
//   // console.log(util.getSafe(state, ["persistent", "loadOrder", profile.id], []));
//   // console.log("---");*/
// }

function main(context: types.IExtensionContext) {
  context.once(() => undefined);

  registerGame(context);
  registerLoadOrderIntegration(context);
  registerLuaPage(context);
  registerModTypes(context);
  registerInstallers(context);
  registerMerges(context);
  registerActions(context);
  setupReactiveHooks(context);

  return true;
}

function notifyIfModLoaderMissing(context: types.IExtensionContext, _source: 'activation' | 'deploy') {
  try {
    if (sessionModLoaderNotified || sessionModLoaderSuppressed) return;
    const st = context.api.getState();
    const gameId = selectors.activeGameId(st);
    if (gameId !== GAME_ID) return;
    const gp: string | undefined = st.settings.gameMode.discovered[GAME_ID]?.path;
    if (!gp) return;
    // A mod loader is present if either ETB UE4SS or Interpose is installed.
    if (isUE4SSInstalledSync(context) || isInterposeInstalled(context)) return;
    sessionModLoaderNotified = true; // ensure single notification this session unless user installs later
    const notif = {
      type: 'warning',
      message: 'No mod loader is installed, Lua/Blueprint mods will not function.',
      actions: [
        {
          title: 'Install Mod Loader',
          action: () => showModLoaderHubDialog(context).catch(e => log('error', 'Mod Loader dialog via notification failed', e)),
        },
        {
          title: "Don't show again",
          action: () => {
            sessionModLoaderSuppressed = true;
            if (modLoaderNotificationId) { (context.api as any).dismissNotification?.(modLoaderNotificationId); }
          },
        },
      ],
    } as any;
    const ret = context.api.sendNotification?.(notif) as any;
    modLoaderNotificationId = ret?.id || ret;
  } catch { /* ignore */ }
}

function registerGame(context: types.IExtensionContext) {
  context.registerGame({
    id: GAME_ID,
    name: 'Escape The Backrooms',
    mergeMods: true,
    getGameVersion,
    queryPath: findGame,
    supportedTools: [],
    queryModPath: () => '.',
    logo: 'gameart.jpg',
    executable: () => EXECUTABLE,
    requiredFiles: [EXECUTABLE],
    setup: (discovery) => setup(context, discovery),
    requiresCleanup: true,
    compatible: { symlinks: false },
    environment: { SteamAppId: STEAM_ID },
    details: {
      SteamAppId: parseInt(STEAM_ID, 10),
      stopPatterns: STOP_PATTERNS,
      ignoreDeploy: IGNORE_DEPLOY,
      ignoreConflicts: IGNORE_CONFLICTS,
    },
    requiresLauncher,
  });
}

function registerLoadOrderIntegration(context: types.IExtensionContext) {
  context.registerLoadOrder({
    gameId: GAME_ID,
    validate: async () => undefined,
    deserializeLoadOrder: async () => DeserializeLoadOrder(context),
    serializeLoadOrder: async (loadOrder) => SerializeLoadOrder(context, loadOrder),
    toggleableEntries: false,
    usageInstructions:
      'Drag entries to reorder them. Items lower in the list load later.\n\n'
      + 'PAK mods (~mods): the game mounts these in this order, so a mod lower in the list '
      + 'overrides assets from mods above it.\n\n'
      + 'Blueprint mods (LogicMods): this list sets the order their logic runs, written to '
      + 'BPModLoaderMod\'s load_order.txt. It only applies when ETB UE4SS is installed. The pak '
      + 'files stay named as the author shipped them, so their alphabetical order in the folder '
      + 'is left alone (renaming them would stop the mod from loading).\n\n'
      + 'Movie replacers (.bk2) are not affected by this list.',
  });
}

function registerLuaPage(context: types.IExtensionContext) {
  context.registerMainPage(
    'highlight-lab',
    'Lua Mods',
    LuaModsLoadOrderPage,
    {
      id: `${GAME_ID}-lua-mods`,
      group: 'per-game',
      hotkey: 'U',
      visible: () => selectors.activeGameId(context.api.getState()) === GAME_ID,
      priority: 120,
    },
  );
  context.registerReducer(['session', 'lualoadorder'], luaModReducer);
}

function registerModTypes(context: types.IExtensionContext) {
  context.registerModType(
    MODTYPE_MOVIES,
    95,
    ETBMoviesModType.isSupported,
    (game) => ETBMoviesModType.getPath(context, game),
    ETBMoviesModType.test,
    ETBMoviesModType.options,
  );

  context.registerModType(
    MODTYPE_PAK,
    25,
    ETBPAKModType.isSupported,
    (game) => ETBPAKModType.getPath(context, game),
    ETBPAKModType.test,
    { mergeMods: (mod) => ETBPAKModType.options.mergeMods(mod, context), name: 'PAK Mod' },
  );

  context.registerModType(
    MODTYPE_LOGICMODS,
    30,
    ETBLogicModsModType.isSupported,
    (game) => ETBLogicModsModType.getPath(context, game),
    ETBLogicModsModType.test,
    { mergeMods: true, name: 'Blueprint Mod (LogicMods)' },
  );
}

function registerInstallers(context: types.IExtensionContext) {
  context.registerInstaller(
    INSTALLER_MOVIES,
    90,
    ETBMovieInstaller.test,
    (files) => ETBMovieInstaller.install(files, context),
  );

  context.registerInstaller(
    INSTALLER_BP_LUA,
    90,
    ETBBluePrintOrLuaInstaller.test,
    ETBBluePrintOrLuaInstaller.install,
  );
}

function registerMerges(context: types.IExtensionContext) {
  context.registerMerge(
    (game) => ETBMovieMerger.test(context, game),
    (filePath, mergePath) => ETBMovieMerger.merge(context, filePath, mergePath),
    ETBMovieMerger.modtype,
  );

  // NOTE: LogicMods (blueprint) paks are deliberately NOT merged/renamed here.
  // BPModLoaderMod derives each mod's asset path from the pak's file name
  // (/Game/Mods/<pakName>/ModActor), so renaming a pak stops the mod loading.
  // Their load order is written to BPModLoaderMod/load_order.txt instead,
  // see util/bpModLoaderUtil.
}

function registerActions(context: types.IExtensionContext) {
  context.registerAction(
    'mod-icons',
    120,
    'open-ext',
    {},
    'Open Save Game Folder',
    () => {
      const saveGameFolderPath = path.join(
        VortexUtils.GetLocalAppDataPath(),
        'EscapeTheBackrooms',
        'Saved',
        'SaveGames',
      );
      try {
        util.opn(saveGameFolderPath);
      } catch (error) {
        log('warn', 'Error opening save folder', error);
      }
    },
    () => selectors.activeGameId(context.api.getState()) === GAME_ID,
  );

  // Consolidated Mod Loader submenu action
  context.registerAction(
    'mod-icons',
    125,
    'download',
    {},
    'Mod Loader',
    () => { showModLoaderHubDialog(context).catch(e => log('error', 'Mod Loader dialog error', e)); },
    () => selectors.activeGameId(context.api.getState()) === GAME_ID,
  );
}


async function showModLoaderHubDialog(context: types.IExtensionContext): Promise<void> {
  const ue4ssInstalled = isUE4SSInstalledSync(context);
  const ue4ssVersion = ue4ssInstalled ? (getUE4SSVersionSync(context) || 'unknown') : null;
  const interposeInstalled = isInterposeInstalled(context);

  const statusParts: string[] = [];
  if (ue4ssInstalled) statusParts.push(`ETB UE4SS ${ue4ssVersion}`);
  if (interposeInstalled) statusParts.push('Interpose');
  const statusLine = statusParts.length
    ? 'Installed: ' + statusParts.join(', ')
    : 'Nothing installed yet.';

  const anyInstalled = ue4ssInstalled || interposeInstalled;

  // Independent checkboxes so the user can install ETB UE4SS and/or Interpose.
  // Pre-check ETB UE4SS when nothing is installed yet; never force Interpose.
  const checkboxes = [
    {
      id: 'etb',
      text: 'ETB UE4SS: ETB-specific fork (used for Lua or C++ mods)',
      value: ue4ssInstalled ? false : !interposeInstalled,
    },
    {
      id: 'interpose',
      text: 'Interpose: Blueprint Mod Loader (used for LogicMods mods)',
      value: false,
    },
  ];

  const btns: any[] = [{ label: 'Install Selected' }];
  if (anyInstalled) btns.push({ label: 'Uninstall...' });
  btns.push({ label: 'Close' });

  const result = await context.api.showDialog(
    'question',
    'Mod Loader Management',
    {
      text: `${statusLine}\n\nSelect the mod loader(s) to install or update. You can pick either one or both (recommended).`,
      checkboxes,
    },
    btns,
  );

  if (result.action === 'Close') return;

  if (result.action === 'Uninstall...') {
    return showUninstallDialog(context, ue4ssInstalled, interposeInstalled);
  }

  const selected = result.input || {};
  if (!selected['etb'] && !selected['interpose']) {
    context.api.sendNotification?.({
      type: 'info',
      message: 'No mod loader selected, nothing to install.',
      displayMS: 4000,
    });
    return;
  }

  if (selected['etb']) {
    try {
      await installETBUE4SS(context);
    } catch (e) {
      context.api.showErrorNotification('Failed to download ETB UE4SS', e);
    }
  }
  if (selected['interpose']) {
    try {
      await installInterpose(context);
    } catch (e) {
      context.api.showErrorNotification('Failed to install Interpose', e);
    }
  }
}

async function showUninstallDialog(
  context: types.IExtensionContext,
  ue4ssInstalled: boolean,
  interposeInstalled: boolean,
): Promise<void> {
  const checkboxes: any[] = [];
  if (ue4ssInstalled) checkboxes.push({ id: 'etb', text: 'ETB UE4SS', value: false });
  if (interposeInstalled) checkboxes.push({ id: 'interpose', text: 'Interpose', value: false });

  if (!checkboxes.length) {
    await context.api.showDialog('info', 'Nothing to uninstall', { text: 'No mod loaders are currently installed.' }, [{ label: 'OK' }]);
    return;
  }

  const result = await context.api.showDialog(
    'question',
    'Uninstall Mod Loader Components',
    { text: 'Select which components to remove. You can pick either one or both.', checkboxes },
    [{ label: 'Uninstall Selected' }, { label: 'Back' }, { label: 'Cancel' }],
  );

  if (result.action === 'Cancel') return;
  if (result.action === 'Back') return showModLoaderHubDialog(context);

  const selected = result.input || {};
  const errors: string[] = [];

  if (selected['etb']) {
    try { await uninstallETBUE4SS(context); } catch (e) { errors.push('ETB UE4SS: ' + e); }
  }
  if (selected['interpose']) {
    try { await removeVortexMod(context, INTERPOSE_NEXUS_MOD_ID, 'Interpose'); } catch (e) { errors.push('Interpose: ' + e); }
  }

  if (errors.length) {
    context.api.showErrorNotification('Some components failed to uninstall', errors.join('\n'));
  }
}


async function ensureGameFolders(context: types.IExtensionContext, gamePath: string): Promise<void> {
  // ~mods and LogicMods are engine/loader-agnostic deploy targets, so always ensure them.
  const targets = [
    { p: path.join(gamePath, MODSFOLDER_PATH), label: '~mods' },
    { p: path.join(gamePath, LOGICMODS_PATH), label: 'LogicMods' },
  ];
  // Win64/UE4SS/Mods belongs to UE4SS. Only ensure/seed it when UE4SS is actually
  // installed. Fabricating it otherwise creates UE4SS's folder structure without
  // UE4SS present, which also makes it look installed when it isn't.
  if (isUE4SSInstalledSync(context)) {
    targets.push({ p: path.join(gamePath, 'EscapeTheBackrooms', 'Binaries', 'Win64', UE4SS_MODS_SUBPATH), label: 'Win64/UE4SS/Mods' });
  }

  const blocked: { p: string; label: string }[] = [];
  for (const t of targets) {
    try {
      await fs.ensureDirWritableAsync(t.p);
      // Seed Mods.txt for the UE4SS/Mods folder
      if (t.label === 'Win64/UE4SS/Mods') {
        const modsTxt = path.join(t.p, 'Mods.txt');
        const exists = await fs.statAsync(modsTxt).then(() => true).catch(() => false);
        if (!exists) await fs.writeFileAsync(modsTxt, '; Created by Vortex\n', { encoding: 'utf8' }).catch(() => undefined);
      }
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        blocked.push(t);
      } else {
        log('warn', `Could not ensure game folder ${t.label}`, err);
      }
    }
  }

  if (blocked.length === 0) return;

  const labels = blocked.map(b => b.label).join(', ');
  const blockedPaths = blocked.map(b => b.p);
  context.api?.sendNotification?.({
    type: 'warning',
    title: 'Mod folders need admin access',
    message: `Cannot create: ${labels}. Mods may not deploy correctly.\n\n${blockedPaths.join('\n')}`,
    actions: [
      {
        title: 'Create (Elevated)',
        action: (dismiss: () => void) => {
          dismiss();
          createDirsElevated(blockedPaths)
            .then(() => context.api?.sendNotification?.({ type: 'success', message: 'Mod folders created. Re-deploy if needed.' }))
            .catch(() => context.api?.sendNotification?.({ type: 'error', message: 'Elevated folder creation failed. Run Vortex as Administrator.' }));
        },
      },
      {
        title: 'Dismiss',
        action: (dismiss: () => void) => dismiss(),
      },
    ],
  } as any);
}

function createDirsElevated(dirs: string[]): Promise<void> {
  const os = require('os');
  const cp = require('child_process');
  const fsNative = require('fs');
  const scriptPath = path.join(os.tmpdir(), `vortex_etb_mkdir_${Date.now()}.ps1`);
  const lines = dirs.map(d => `New-Item -ItemType Directory -Force -Path '${d.replace(/'/g, "''")}'`);
  fsNative.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
  const escapedScript = scriptPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return new Promise<void>((resolve) => {
    cp.execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -NonInteractive -File ''${escapedScript}'''`,
    ], () => {
      try { fsNative.unlinkSync(scriptPath); } catch { /* ignore */ }
      resolve();
    });
  });
}

function setupReactiveHooks(context: types.IExtensionContext) {
  context.once(() => {
    monitor = new LuaModsMonitor(context.api);

    context.api.events.on('gamemode-activated', async (g) => {
      if (g === GAME_ID) return monitor.start();
      return monitor.stop();
    });
    context.api.events.on('gamemode-activated', async (g) => {
      if (g !== GAME_ID) return;
      const st = context.api.getState();
      const gp: string | undefined = st.settings.gameMode.discovered[GAME_ID]?.path;
      if (!gp) return;
      await ensureGameFolders(context, gp);
      notifyIfModLoaderMissing(context, 'activation');
      cleanupStaleLogicModPaks(context.api).catch(e => log('warn', 'Stale LogicMods cleanup failed', e));
      checkInterposeOutdated(context).catch(e => log('warn', 'Interpose version check failed', e));
    });
    context.api.events.on('will-deploy', () => monitor.pause());
    context.api.events.on('will-purge', () => monitor.pause());
    context.api.events.on('did-deploy', () => {
      monitor.resume();
      refreshLuaMods(context.api);
      notifyIfModLoaderMissing(context, 'deploy');
      // Remove any stale AAA_-prefixed paks left by the old merge approach, then
      // (re)write the blueprint load order. It lives in BPModLoaderMod/
      // load_order.txt, not in the pak file names.
      cleanupStaleLogicModPaks(context.api)
        .then(() => writeBPModLoadOrder(context.api))
        .catch(err => log('error', 'LogicMods post-deploy maintenance failed', err));
    });
    context.api.events.on('did-purge', () => {
      monitor.resume();
      refreshLuaMods(context.api);
    });
    context.api.events.on('profile-did-change', (pid: string) => {
      const st = context.api.getState();
      const profile = selectors.profileById(st, pid);
      if (profile.gameId !== GAME_ID) return;
      refreshLuaMods(context.api);
    });

    context.api.setStylesheet('etb-styles', path.join(__dirname, 'custom-styles.scss'));

    context.api.onStateChange(['session', 'lualoadorder'], (prev, curr) => {
      const st = context.api.getState();
      const gameId = selectors.activeGameId(st);
      const profile = selectors.activeProfile(st);
      if (gameId !== GAME_ID || !profile) return;

      const prevLO = prev[profile.id];
      const currLO = curr[profile.id];
      if (!prevLO || prevLO === currLO) return;

      const gp: string | undefined = st.settings.gameMode.discovered[GAME_ID]?.path;
      if (!gp) return;

      const modsPath = path.join(gp, 'EscapeTheBackrooms', 'Binaries', 'Win64', UE4SS_MODS_SUBPATH, 'Mods.txt');
      monitor.pause();
      writeManifest(currLO, modsPath)
        .catch((err) => log('error', 'Could not write LUA manifest', err))
        .finally(() => monitor.resume());
    });
  });
}

/**
 * Should be used to filter and insert wanted data into Vortex's loadOrder application state. Once that's done, Vortex
 * will trigger a serialization event which will ensure the data is written to the load order file.
 */
async function DeserializeLoadOrder(context: types.IExtensionContext): Promise<types.LoadOrder> {
  const props: IProps = GetVortexProperties(context);
  const loadOrderPath = path.join(
    VortexUtils.GetUserDataPath(),
    props.profile.gameId,
    `${props.profile.id}_${LOADORDER_FILE}`,
  );

  const currentModsState = util.getSafe(props.profile, ['modState'], {});
  const enabledModIds = Object
    .keys(currentModsState)
    .filter((m) => util.getSafe(currentModsState, [m, 'enabled'], false));

  const mods: Record<string, types.IMod> = util.getSafe(
    props.state,
    ['persistent', 'mods', GAME_ID],
    {},
  );

  let data: ILoadOrderEntry[] = [];
  try {
    const fileData = await fs.readFileAsync(loadOrderPath, { encoding: 'utf8' });
    try {
      data = JSON.parse(fileData);
    } catch (err) {
      log('error', 'Error decoding load order JSON', err);
    }
  } catch {
    // missing file is acceptable
  }

  const filteredData = data.filter((e) => enabledModIds.includes(e.id));
  const newMods = enabledModIds.filter(
    (id) =>
      [MODTYPE_PAK, MODTYPE_MOVIES, MODTYPE_LOGICMODS].includes(mods[id]?.type) &&
      filteredData.find((lo) => lo.id === id) === undefined,
  );

  newMods.forEach((nm) =>
    filteredData.push({
      id: nm,
      modId: nm,
      enabled: true,
      name: mods[nm] ? util.renderModName(mods[nm]) : nm,
    }),
  );

  return Promise.resolve(filteredData);
}

async function SerializeLoadOrder(
  context: types.IExtensionContext,
  loadOrder: types.LoadOrder,
): Promise<void> {
  const props: IProps = GetVortexProperties(context);
  const loadOrderPath = path.join(
    VortexUtils.GetUserDataPath(),
    props.profile.gameId,
    `${props.profile.id}_${LOADORDER_FILE}`,
  );
  try {
    await fs.writeFileAsync(loadOrderPath, JSON.stringify(loadOrder, null, 4), {
      encoding: 'utf8',
    });
  } catch (e) {
    return Promise.reject(e);
  }
  context.api.store.dispatch(actions.setDeploymentNecessary(GAME_ID, true));
  return Promise.resolve();
}

async function setup(context: types.IExtensionContext, discovery: types.IDiscoveryResult): Promise<void> {
  // Only create the loader-agnostic mod folders. The Win64/UE4SS/Mods folder is
  // created by UE4SS itself (or by installETBUE4SS), so don't fabricate it here.
  const foldersToCreate = [
    path.join(discovery.path, MODSFOLDER_PATH),
    path.join(discovery.path, LOGICMODS_PATH),
  ];
  for (const f of foldersToCreate) {
    await fs.ensureDirWritableAsync(f).catch(() => undefined);
  }
}

async function requiresLauncher(gamePath: string, store?: string) {
  return Promise.resolve({
    launcher: 'steam',
    addInfo: { appId: STEAM_ID, parameters: [], launchType: 'gamestore' },
  });
}

async function findGame() {
  try {
    const g: types.IGameStoreEntry = await util.GameStoreHelper.findByAppId([
      STEAM_ID,
    ]);
    return Promise.resolve(g.gamePath);
  } catch (e) {
    return Promise.reject(e);
  }
}

function GetVortexProperties(
  context: types.IExtensionContext,
  profileId?: string,
): IProps {
  const api = context.api;
  const state = api.getState();
  const profile: types.IProfile =
    profileId !== undefined
      ? selectors.profileById(state, profileId)
      : selectors.activeProfile(state);
  if (profile?.gameId !== GAME_ID) return undefined;
  const discovery: types.IDiscoveryResult = util.getSafe(
    state,
    ['settings', 'gameMode', 'discovered', GAME_ID],
    undefined,
  );
  if (discovery?.path === undefined) return undefined;
  const mods = util.getSafe(state, ['persistent', 'mods', GAME_ID], {});
  return { api, state, profile, mods, discovery };
}

export default main;
