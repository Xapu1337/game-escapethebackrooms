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
