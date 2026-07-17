# Escape The Backrooms, Vortex Extension

This is an extension for [Vortex](https://www.nexusmods.com/about/vortex/) to add support for Escape The Backrooms. This is available for the PC on [Steam](https://store.steampowered.com/app/1943950/Escape_the_Backrooms/)

## Features

- Support for PAK-based mods
- Support for BK2-based mods (movie files)
- Support for UE4SS Blueprint\Lua mods
- Support for load order of PAK mods
- Support for Lua mods enabling and disabling
- Automatic game detection
<!-- - Installation of archives which include more than one mod.
- Automatic detection of ModBuddy (the XCOM 2 modding toolkit).
  Load order management (including Steam Workshop entires) -->

## Installation

This extension requires Vortex >= 1.7.5. To install, click the Vortex button at the top of the page to open this extension within Vortex, and then click Install.

You can also manually install it by downloading the main file and dragging it into the 'drop zone' labelled Drop File(s) in the Extensions tab at the bottom right.

Afterwards, restart Vortex and you can begin installing supported Escape The Backrooms mods with Vortex.

If updating an extension, migration occurs that purges your mods folder and reinstalls any mods.

## Game detection

The Escape The Backrooms game extension enables Vortex to automatically locate installs from the Steam.

It is also possible to manually set the game folder if the auto detection doesn't find the correct installation. A valid Escape The Backrooms game folder contains:

- `Backrooms.exe`
- `/Engine`
- `/EscapeTheBackrooms`

If your game lacks these files/folders then it is likely that your installation has become corrupted somehow.

## Mod Management

By default, Vortex will deploy files to the game's root folder and extracts the archive while preserving the folder structure.

Vortex will deploy files to the game's mod folder (`/EscapeTheBackrooms/Content/Paks/~mods`) if only `.pak` files are detected and extracts all nested files in the archive to their own individual within this one, ignoring archive folder structure. Each mod folder will be prefixed based on the users load order set within Vortex. Any files that are overwritten are backed up for when the mod is disabled or removed.

This extension also supports mods that overwrite the game's movie files, located within subfolders under `/EscapeTheBackrooms/Content/Movies`. When a mod is added that contains at least 1 `.bk2` file, the `etb-modtype-movies` installer is used. This searches through the movies folder within the game and attempts to match anything that matches inside of the mod archive. If found, Vortex overwrites them (after backing up the originals) and if any `pak` files are also found within a movie mod, then these are processed the same as a pak-only mod.

## Mod Loader Install

A "Mod Loader" action is available in the Mods toolbar to install the loader(s) required for Blueprint/Lua logic mods. You can choose either one or both of:

- **ETB UE4SS** — an ETB-specific UE4SS fork. Vortex downloads the latest GitHub release and extracts it directly into the game directory. If you already have a customised UE4SS install, back it up before using the action.
- **Interpose** — a Nexus-hosted mod loader, installed and managed as a regular Vortex mod.

Installing one no longer forces the other — pick whichever the mods you use require. The same dialog lets you uninstall either component later.

## Load Order

The load order of mods can now be set within Vortex to allow greater control over what mods are loaded before other mods. This is important so as multiple mods can change the same thing and so load order can be used to minimize collisions. Mods loaded last will have priority over mods loaded first.

<!--Individual mod entries can be enabled/disabled from the load order section.


## Load Order Management

This extension utilises the "File Based Load Order (FBLO)" framework provided by the core Vortex application. A list of `XComMod` installations present in the game folder is generated and each entry can be re-ordered, enabled or disabled.

A list of enabled mods in the load order is automatically written to the `DefaultModOptions.ini` file, which tells the game which mods to load and in what order.

## Steam Workshop detection

The load order section will also detect mods installed from the Steam Workshop and display them in the load order. These entries can be managed like any other, however, the mod files themselves are not managed by Vortex and must be managed by Steam. You can also use the [Import from Steam Workshop](https://www.nexusmods.com/site/mods/114) extension to import these mods into Vortex.-->

## Development

Build:

```
npm install
npm run build
```

Outputs go to `dist/` (webpack bundle + `info.json`).

Contributions welcome, see `CONTRIBUTING.md` & `CODE_OF_CONDUCT.md`.

## See also

<!--- [Source Code (GitHub)](https://github.com/insomnious/game-halothemasterchiefcollection)-->

- [Download the Extension (Nexus Mods)](https://www.nexusmods.com/site/mods/1007)
- [Mods for Escape The Backrooms (Nexus Mods)](https://www.nexusmods.com/escapethebackrooms)
- [Download Vortex (Nexus Mods)](https://www.nexusmods.com/about/vortex/)
- [Vortex Knowledge Base (Nexus Mods)](https://wiki.nexusmods.com/index.php/Category:Vortex)

## Credits

Based on the [extension](https://www.nexusmods.com/site/mods/520) for [Hogwarts Legacy](https://www.nexusmods.com/hogwartslegacy) by [lordvoldem0rt](https://next.nexusmods.com/profile/lordvoldem0rt)
