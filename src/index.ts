import path from 'path';
import { actions, fs, log, selectors, types, util } from 'vortex-api';
import * as VortexUtils from './VortexUtils';
import { ILoadOrderEntry, IProps } from './types';
import Migrate from './migration';
import { LuaModsMonitor, refreshLuaMods, writeManifest } from './util/luaModsUtil';
import LuaModsLoadOrderPage from './views/LuaModsLoadOrderPage';
import { luaModReducer } from './reducers/luaReducer';

// IDs for different stores and nexus
import {
  STEAM_ID,
  GAME_ID,
  EXECUTABLE,
  MODSFOLDER_PATH,
  MOVIESMOD_PATH,
  IGNORE_CONFLICTS,
  IGNORE_DEPLOY,
  STOP_PATTERNS,
  MODTYPE_MOVIES,
  MODTYPE_PAK,
  INSTALLER_MOVIES,
  INSTALLER_BP_LUA,
  ETB_UE4SS_NEXUS_MOD_ID,
  INTERPOSE_NEXUS_MOD_ID,
} from './common';
import installOrUpdateUE4SS, {
  uninstallUE4SS, isUE4SSInstalledSync, getUE4SSVersionSync,
  fetchUE4SSReleases, installSpecificUE4SSRelease,
  isETBUE4SSInstalled, isInterposeInstalled,
  installETBUE4SS, installInterpose,
  removeVortexMod,
  IUE4SSGitHubRelease,
} from './util/ue4ssDownloader';
import ETBMovieInstaller from './installers/etb-installer-movies';
import ETBBluePrintOrLuaInstaller from './installers/etb-installer-bp-lua';
import ETBMoviesModType from './modtypes/etb-modtype-movies';
import ETBPAKModType from './modtypes/etb-modtype-pak';
import ETBMovieMerger from './merges/etb-movies-merge';

let monitor: LuaModsMonitor;

const LOADORDER_FILE = 'loadOrder.json';
const VERSION_PATH = path.join('EscapeTheBackrooms', 'Content', 'Data', 'Version', 'DA_Version.txt');
let sessionUE4SSNotified = false;
let sessionUE4SSSuppressed = false;
let ue4ssNotificationId: string | undefined;

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
  registerMigrations(context);
  registerModTypes(context);
  registerInstallers(context);
  registerMerges(context);
  registerActions(context);
  setupReactiveHooks(context);

  return true;
}

function notifyIfUE4SSMissing(context: types.IExtensionContext, _source: 'activation' | 'deploy') {
  try {
    if (sessionUE4SSNotified || sessionUE4SSSuppressed) return;
    const st = context.api.getState();
    const gameId = selectors.activeGameId(st);
    if (gameId !== GAME_ID) return;
    const gp: string | undefined = st.settings.gameMode.discovered[GAME_ID]?.path;
    if (!gp) return;
    if (isUE4SSInstalledSync(context)) return;
    sessionUE4SSNotified = true; // ensure single notification this session unless user installs later
    const notif = {
      type: 'warning',
      message: 'UE4SS is not installed – Lua/Blueprint mods will not function.',
      actions: [
        {
          title: 'Install UE4SS',
          action: () => installOrUpdateUE4SS(context).catch(e => log('error', 'UE4SS install via notification failed', e)),
        },
        {
          title: "Don't show again",
          action: () => {
            sessionUE4SSSuppressed = true;
            if (ue4ssNotificationId) { (context.api as any).dismissNotification?.(ue4ssNotificationId); }
          },
        },
      ],
    } as any;
    const ret = context.api.sendNotification?.(notif) as any;
    ue4ssNotificationId = ret?.id || ret;
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
    setup,
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
      'Re-position entries by dragging and dropping them. Mods further down load last and win conflicts. Movie replacers (.bk2) are unaffected; only PAK style files are.',
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

function registerMigrations(context: types.IExtensionContext) {
  context.registerMigration((oldVer) => Migrate(context, oldVer));
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

  // Consolidated UE4SS submenu action
  context.registerAction(
    'mod-icons',
    125,
    'download',
    {},
    'UE4SS',
    () => { showUE4SSHubDialog(context).catch(e => log('error', 'UE4SS dialog error', e)); },
    () => selectors.activeGameId(context.api.getState()) === GAME_ID,
  );
}

// ── UE4SS Management Dialogs ──

async function showUE4SSHubDialog(context: types.IExtensionContext): Promise<void> {
  const stdInstalled = isUE4SSInstalledSync(context);
  const stdVersion = stdInstalled ? (getUE4SSVersionSync(context) || 'unknown') : null;
  const etbInstalled = isETBUE4SSInstalled(context);
  const interposeInstalled = isInterposeInstalled(context);

  const statusParts: string[] = [];
  if (stdInstalled) statusParts.push(`Standard UE4SS ${stdVersion}`);
  if (etbInstalled) statusParts.push('ETB UE4SS');
  if (interposeInstalled) statusParts.push('Interpose');
  const statusLine = statusParts.length
    ? 'Installed: ' + statusParts.join(', ')
    : 'No UE4SS variant is currently installed.';

  const anyInstalled = stdInstalled || etbInstalled || interposeInstalled;

  const choices = [
    { id: 'standard', text: 'Standard UE4SS (select version from GitHub)', value: false },
    { id: 'etb', text: 'ETB UE4SS (Recommended) — optimized fork for ETB', value: true },
    { id: 'interpose', text: 'Interpose — additional mod loader', value: false },
  ];

  const btns: any[] = [{ label: 'Continue' }];
  if (anyInstalled) btns.push({ label: 'Uninstall...' });
  btns.push({ label: 'Close' });

  const result = await context.api.showDialog(
    'question',
    'UE4SS Management',
    { text: statusLine, choices },
    btns,
  );

  if (result.action === 'Close') return;

  if (result.action === 'Uninstall...') {
    return showUninstallDialog(context, stdInstalled, etbInstalled, interposeInstalled);
  }

  // Find which choice is selected
  const selected = Object.entries(result.input || {}).find(([, v]) => v === true)?.[0];

  if (selected === 'standard') {
    return showVersionPickerDialog(context);
  } else if (selected === 'etb') {
    try {
      await installETBUE4SS(context);
    } catch (e) {
      context.api.showErrorNotification('Failed to download ETB UE4SS', e);
    }
  } else if (selected === 'interpose') {
    installInterpose(context);
  }
}

async function showVersionPickerDialog(context: types.IExtensionContext): Promise<void> {
  let releases: IUE4SSGitHubRelease[];
  try {
    releases = await fetchUE4SSReleases(10);
  } catch (e) {
    context.api.showErrorNotification('Failed to fetch UE4SS releases', e);
    return;
  }
  if (!releases.length) {
    context.api.showErrorNotification('No UE4SS releases found', 'GitHub returned no releases with downloadable assets.');
    return;
  }

  const currentVersion = getUE4SSVersionSync(context);
  const choices = releases.map((r, i) => {
    let label = r.tag_name;
    if (currentVersion && r.tag_name === currentVersion) label += ' (installed)';
    if (i === 0) label += ' [latest]';
    return { id: r.tag_name, text: label, value: i === 0 };
  });

  const result = await context.api.showDialog(
    'question',
    'Select UE4SS Version',
    { text: 'Pick a version to install. The latest release is pre-selected.', choices },
    [{ label: 'Install' }, { label: 'Back' }, { label: 'Cancel' }],
  );

  if (result.action === 'Cancel') return;
  if (result.action === 'Back') return showUE4SSHubDialog(context);

  const selectedTag = Object.entries(result.input || {}).find(([, v]) => v === true)?.[0];
  const selectedRelease = releases.find(r => r.tag_name === selectedTag);
  if (!selectedRelease) {
    context.api.showErrorNotification('No version selected', 'Please select a version before clicking Install.');
    return;
  }

  try {
    await installSpecificUE4SSRelease(context, selectedRelease);
  } catch (e) {
    context.api.showErrorNotification('Failed to install UE4SS ' + selectedRelease.tag_name, e);
  }
}

async function showUninstallDialog(
  context: types.IExtensionContext,
  stdInstalled: boolean,
  etbInstalled: boolean,
  interposeInstalled: boolean,
): Promise<void> {
  const choices: any[] = [];
  if (stdInstalled) choices.push({ id: 'standard', text: 'Standard UE4SS (direct install)', value: true });
  if (etbInstalled) choices.push({ id: 'etb', text: 'ETB UE4SS (Vortex mod)', value: false });
  if (interposeInstalled) choices.push({ id: 'interpose', text: 'Interpose (Vortex mod)', value: false });

  if (!choices.length) {
    await context.api.showDialog('info', 'Nothing to uninstall', { text: 'No UE4SS variants are currently installed.' }, [{ label: 'OK' }]);
    return;
  }

  const result = await context.api.showDialog(
    'question',
    'Uninstall UE4SS Components',
    { text: 'Select which components to remove.', choices },
    [{ label: 'Uninstall Selected' }, { label: 'Back' }, { label: 'Cancel' }],
  );

  if (result.action === 'Cancel') return;
  if (result.action === 'Back') return showUE4SSHubDialog(context);

  const selected = result.input || {};
  const errors: string[] = [];

  if (selected['standard']) {
    try { await uninstallUE4SS(context); } catch (e) { errors.push('Standard UE4SS: ' + e); }
  }
  if (selected['etb']) {
    try { await removeVortexMod(context, ETB_UE4SS_NEXUS_MOD_ID, 'ETB UE4SS'); } catch (e) { errors.push('ETB UE4SS: ' + e); }
  }
  if (selected['interpose']) {
    try { await removeVortexMod(context, INTERPOSE_NEXUS_MOD_ID, 'Interpose'); } catch (e) { errors.push('Interpose: ' + e); }
  }

  if (errors.length) {
    context.api.showErrorNotification('Some components failed to uninstall', errors.join('\n'));
  }
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
      const modsDir = path.join(gp, 'EscapeTheBackrooms', 'Binaries', 'Win64', 'Mods');
      try {
        await fs.ensureDirWritableAsync(modsDir).catch(() => undefined);
        const modsTxt = path.join(modsDir, 'Mods.txt');
        const exists = await fs.statAsync(modsTxt).then(() => true).catch(() => false);
        if (!exists) {
          await fs.writeFileAsync(modsTxt, '; Created by Vortex\n', { encoding: 'utf8' }).catch(() => undefined);
        }
      } catch { /* ignore */ }
      // First activation notification (async, non-blocking)
      notifyIfUE4SSMissing(context, 'activation');
    });
    context.api.events.on('will-deploy', () => monitor.pause());
    context.api.events.on('will-purge', () => monitor.pause());
    context.api.events.on('did-deploy', () => {
      monitor.resume();
      refreshLuaMods(context.api);
      notifyIfUE4SSMissing(context, 'deploy');
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

      const modsPath = path.join(gp, 'EscapeTheBackrooms', 'Binaries', 'Win64', 'Mods', 'Mods.txt');
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
      [MODTYPE_PAK, MODTYPE_MOVIES].includes(mods[id]?.type) &&
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

//#region SOMETHING

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

//#endregion

async function setup(discovery: types.IDiscoveryResult) {
  const p = path.join(discovery.path, MODSFOLDER_PATH);
  try {
    await fs.ensureDirWritableAsync(p);
    // also ensure Mods folder structure for Lua (avoid ENOENT later)
    const modsDir = path.join(discovery.path, 'EscapeTheBackrooms', 'Binaries', 'Win64', 'Mods');
    await fs.ensureDirWritableAsync(modsDir).catch(() => undefined);
    const modsTxt = path.join(modsDir, 'Mods.txt');
    const exists = await fs.statAsync(modsTxt).then(() => true).catch(() => false);
    if (!exists) await fs.writeFileAsync(modsTxt, '; Created by Vortex\n', { encoding: 'utf8' }).catch(() => undefined);
    return Promise.resolve;
  } catch (e) {
    return Promise.reject(e);
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
