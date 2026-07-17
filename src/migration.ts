import path from "path";
import * as VortexUtils from "./VortexUtils";
import { types, log, actions, fs, selectors, util } from "vortex-api";
import { GAME_ID, MODSFOLDER_PATH, MODTYPE_PAK, MODTYPE_LOGICMODS, LOGICMODS_PATH } from './common';
import semver from "semver";

async function migrate0_2_11(context: types.IExtensionContext, oldversion: string) {
  log("info", "Migrating to 0.2.11", oldversion);

  const state = context.api.getState();
  const mods = state.persistent.mods[GAME_ID] ?? {};

  if (!Object.keys(mods).length) {
    log("info", "No mods to migrate for Escape The Backrooms");
    return;
  }

  // Find mods that have PAKs and change the modtype.
  const defaultMods = Object.values(mods).filter((m) => m.type === "");
  if (!defaultMods.length) return;

  // Clean up the ~mods folder.
  try {
    const gamePath = state.settings.gameMode.discovered?.[GAME_ID]?.path;
    if (!gamePath) {
      log("info", "No path save for Escape The Backrooms, aborting migration");
      return;
    }
    const modsFolder = path.join(gamePath, MODSFOLDER_PATH);
    await context.api.emitAndAwait(
      "purge-mods-in-path",
      GAME_ID,
      "",
      modsFolder,
    );
  } catch (err) {
    log("error", "Failed to clean up ~mods folder for Escape The Backrooms", err);
  }

  // Reset the load order by deleting the JSON file.
  try {
    const loadorderPath = path.join(VortexUtils.GetUserDataPath(), GAME_ID);
    const loFiles = (await fs.readdirAsync(loadorderPath)).filter((f) =>
      f.endsWith("loadOrder.json"),
    );
    for (const file of loFiles) {
      log("debug", "Removing LO file");
      await fs.unlinkAsync(path.join(loadorderPath, file));
    }
  } catch (err) {
    log("error", "Could not remove load order files", err);
  }

  const stagingPath = selectors.installPathForGame(state, GAME_ID);

  for (const mod of defaultMods) {
    const modFolder = path.join(stagingPath, mod.installationPath);

    try {
      const modFiles = await fs.readdirAsync(modFolder);
      // If no PAKs, skip.
      if (!modFiles.find((f) => path.extname(f) === ".pak")) continue;
      const exceptions = modFiles.find(
        (f) =>
          f.toLowerCase().endsWith(".lua") ||
          f.toLowerCase().endsWith("ue4sslogicmod.info") ||
          f.toLowerCase().endsWith(".ue4sslogicmod") ||
          f.toLowerCase().endsWith(".logicmod"),
      );
      // If exception files, skip.
      if (exceptions) continue;

      log("debug", `Changing mod type: ${mod.attributes.name}`);
      const dispatch = context.api.store?.dispatch;
      dispatch(actions.setModType(GAME_ID, mod.id, MODTYPE_PAK));
    } catch (err) {
      log("error", `Error checking mod ${mod.id}`, err);
    }
  }
}

async function migrate0_1_3(context: types.IExtensionContext) {
  const state = context.api.getState();
  const mods = state.persistent.mods[GAME_ID] ?? {};
  const dispatch = context.api.store?.dispatch;

  const logicModsMods = Object.values(mods).filter((m) => m.type === MODTYPE_LOGICMODS);
  if (!logicModsMods.length) return;

  // Purge the old (broken) MODTYPE_LOGICMODS deployment before retyping
  const gamePath = state.settings.gameMode.discovered?.[GAME_ID]?.path;
  if (gamePath) {
    const logicModsPath = path.join(gamePath, LOGICMODS_PATH);
    try {
      await context.api.emitAndAwait('purge-mods-in-path', GAME_ID, MODTYPE_LOGICMODS, logicModsPath);
    } catch (err) {
      log('warn', 'Could not purge LogicMods deployment during 0.1.3 migration', err);
    }
  }

  // Reset all MODTYPE_LOGICMODS mods to "" so they redeploy via game root + full path (correct)
  for (const mod of logicModsMods) {
    log('info', `migrate0_1_3: resetting type for mod ${mod.id}`);
    dispatch(actions.setModType(GAME_ID, mod.id, ''));
  }

  dispatch(actions.setDeploymentNecessary(GAME_ID, true));

  context.api.sendNotification?.({
    type: 'info',
    message: 'Blueprint mods (LogicMods) have been reset and will redeploy correctly. Reinstall them to enable load order support.',
  } as any);
}

async function migrate0_1_4(context: types.IExtensionContext) {
  const state = context.api.getState();
  const mods = state.persistent.mods[GAME_ID] ?? {};
  const dispatch = context.api.store?.dispatch;
  const stagingPath = selectors.installPathForGame(state, GAME_ID);

  const defaultMods = Object.values(mods).filter((m) => m.type === '');
  let anyRetyped = false;

  for (const mod of defaultMods) {
    if (!mod.installationPath) continue;
    const logicSubPath = path.join(stagingPath, mod.installationPath, 'EscapeTheBackrooms', 'Content', 'Paks', 'LogicMods');
    const hasLogicMods = await fs.statAsync(logicSubPath).then(() => true).catch(() => false);
    if (!hasLogicMods) continue;
    log('info', `migrate0_1_4: re-assigning MODTYPE_LOGICMODS to ${mod.id}`);
    dispatch(actions.setModType(GAME_ID, mod.id, MODTYPE_LOGICMODS));
    anyRetyped = true;
  }

  if (anyRetyped) {
    dispatch(actions.setDeploymentNecessary(GAME_ID, true));
  }
}

export default async function Migrate(context: types.IExtensionContext, oldVersion: string) {
  /*
   * Performed on main thread, and not render thread, so we can't use usual // console.log
   */

  log("info", `Migrate oldVersion=${oldVersion}`);

  if (semver.lt(oldVersion, "0.1.3")) {
    try {
      await migrate0_1_3(context);
    } catch (err) {
      log("error", "Failed to run migrate0_1_3", err);
    }
  }

  if (semver.lt(oldVersion, "0.1.4")) {
    try {
      await migrate0_1_4(context);
    } catch (err) {
      log("error", "Failed to run migrate0_1_4", err);
    }
  }

  if (semver.lt(oldVersion, "0.2.11")) {
    try {
      await migrate0_2_11(context, oldVersion);
    } catch (err) {
      log("error", "Failed to migrate Escape The Backrooms to 0.2.11");
    }
  }

  // if old version is newer than or equal to this version, then we just ignore
  if (semver.gte(oldVersion, "0.2.10")) {
    log("info", "No need to migrate");
    return Promise.resolve();
  }

  const state = context.api.getState();
  const discoveryPath = util.getSafe(
    state,
    ["settings", "gameMode", "discovered", GAME_ID, "path"],
    undefined,
  );

  if (discoveryPath === undefined) {
    log("warn", "discoveryPath is undefined");
    return Promise.resolve();
  }

  const mods: { [modId: string]: types.IMod } = util.getSafe(
    state,
    ["persistent", "mods", GAME_ID],
    {},
  );
  if (Object.keys(mods).length === 0) {
    log("info", "mods length is 0 so no reason to migrate anything");
    return Promise.resolve();
  }

  const modsPath = path.join(discoveryPath, MODSFOLDER_PATH);

  log("info", `modsPath=${modsPath}`);

  context.api.sendNotification({
    type: "info",
    message:
      "The Escape The Backrooms Extension has been updated. If you previously installed a mod modifying movie files (e.g. paintings) then there is a good chance that they haven't been working as those type of mods weren't officially supported. If this is the case then please reinstall those individual mods.",
  });

  return context.api
    .awaitUI()
    .then(() => fs.ensureDirWritableAsync(modsPath))
    .then(() =>
      context.api.emitAndAwait("purge-mods-in-path", GAME_ID, "", modsPath),
    )
    .then(() =>
      context.api.store.dispatch(actions.setDeploymentNecessary(GAME_ID, true)),
    );

  // migration needs to happen as we are upgrading

  // purge mods?
  //await vortexCommands.PurgeModsAsync(true);

  // deploy mods?
  //await vortexCommands.DeployModsAsync();
}
