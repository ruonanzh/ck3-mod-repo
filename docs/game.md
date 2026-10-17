# Crusader Kings III game mechanics

CK3 (Paradox, Clausewitz/Jomini engine) is a grand-strategy game.
A mod is a set of pure PDXScript text files: `.txt`, `.gui`, `.gfx`, `.asset`, and `.yml`.
A mod needs no compilation and no runtime SDK.
v1 of this workspace targets **Windows only**.

## How the game loads mods

- A mod is a directory under the Paradox user-documents directory. The path is
  `<the player's Documents directory>\Paradox Interactive\Crusader Kings III\mod\<name>\`.
  The player can move the Documents directory, so the tools read it from Windows.
  The Paradox launcher discovers the mod through a `<name>.mod` pointer file **alongside** the mod
  directory; the mod's own identity lives in `descriptor.mod` inside the directory.
- The mod directory holds `descriptor.mod` (key=value identity) and the classic content folders
  directly at its root: `common/`, `events/`, `history/`, `localization/`, `gfx/`, `gui/`,
  `map_data/`, `music/`, and `sound/`. There is no `in_game/`/`main_menu/` split.
- At load time, the game layers the mod files on top of the vanilla files. A file with the same
  name overwrites the vanilla file. A single object is overridden by a later ASCIIbetical filename
  ("Last In Only Served"); GUI `type`/`template` is the opposite ("First In Only Served"). Files
  load in ASCIIbetical order by filename.

## Where to find the reference

The knowledge layer has its own map. See [`INDEX.md`](INDEX.md).
This page describes the game mechanics only.

## Key reminders

- **Windows-only (v1).** The path check reads `binaries/ck3.exe`. macOS/Linux support is out of
  scope for v1.
- **Localization YAML must be UTF-8 with BOM.** Without a BOM, the game ignores the file silently,
  and that failure is fatal.
- **There is no `INJECT:`/`REPLACE:` keyword system.** Override is file- and object-based. See
  [`ck3-modding-conventions.md`](ck3-modding-conventions.md) §1.
- **The mod identity is `descriptor.mod` + `<name>.mod`**, not `.metadata/metadata.json` (that is a
  Victoria 3 / EU5 format). See [`ck3-modding-conventions.md`](ck3-modding-conventions.md) §5.
