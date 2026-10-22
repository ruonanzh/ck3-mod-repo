---
name: mod-creator
description: The guide for writing and modifying CK3 (pdx-script) mods. Always read it first, before you search the vanilla scripts, before you read the reference mods, and before your first write. Covers the two-stage order of work, the mod structure, the `descriptor.mod` fields, localization YAML, the entry mechanisms, `validate_mod` and its name-level checks, and the override and load-order rules that live in the conventions file.
---

# Writing CK3 mods (pdx-script)

A CK3 mod is a directory of **pure PDXScript text files**: `.txt`, `.gui`, `.gfx`, `.asset`, and
`.yml`. There is no compilation and no runtime SDK. Write the mod under `your_mods/<ModName>/`, then
check the result with the `validate_mod` tool.
All paths below are relative to the workspace root, not to the skill directory.

This skill provides domain method only, and it **grants no permissions**. Reading it does not allow
you to create directories, to check or install runtimes, or to modify source files. The session role
and its bound directory gate those actions.

## Usage modes (two roles)

- **Q&A and consultation (read-only).** Answer game-mechanics and mod API questions by reading the
  knowledge layer. Start from `docs/INDEX.md` to locate the right source. You may explain how the
  environment works, in words. Whether this session may locate a path or mirror the scripts is decided
  by the **session role**, not by this skill: the Q&A role forbids both. Do not create or edit any
  file.
- **Writing or modifying the mod.** Run the two stages below, in this order. They exist because CK3 is
  pure PDXScript with no self-describing API: the mechanism is documented, the entry is in the
  vanilla scripts, and the call form is in the lists. Merging the stages produces a plausible file
  that fails in the game.

  **Stage 1: settle what the player wants and where it hangs.** Do not write a file in this stage.

  | # | Step | What you read or run | Output |
  | --- | --- | --- | --- |
  | 0 | **Prepare the paths** | `get_game_info`. When it reports the vanilla scripts missing, run `sync_game_scripts`. The `setup-workspace` skill has the cases. | A mirror that steps 3 and 4 can read |
  | 1 | **Map the request to a page** | `docs/wiki/INDEX.md` — one row per wiki page, with `Local yes/no` | The one page that covers "how do I add X" (`Holdings_modding` for a building, `Event_modding` for an event, …) |
  | 2 | **Read the mechanism** | That page's own table of contents, then only the section the request needs | The required block, its fields, and where the file goes |
  | 3 | **Research the vanilla code** | `grep -rln <keyword> game-scripts/vanilla/game/`, which lists files rather than lines. Open the first, then search inside it with `grep -n`. A name or a scope is a `docs/script_docs/` question. | Real object names, real field values, and the file to mirror |
  | 4 | **Read that window's own `.gui` file** | When the change mounts on an existing window or panel, read its `.gui` file under `game-scripts/vanilla/game/gui/`. Skip this step when no window changes. | The `type` and the block to hook into |
  | 5 | **Agree with the player** | The player. Skip only when the player says to start, for example "start now, no confirmation". Do this even when the request looks specific. | One sentence: what the mod changes, its scope, and its shape |

  Step 4 is a separate step on purpose. A mechanism lives in `common/`, and an attachment point lives
  in `.gui`. When the two merge, you find the `common/` directory and stop, and the UI half is
  missing.

  **Do not start step 3 without the modding context.** `game-scripts/` is not committed, so a fresh workspace
  has no vanilla scripts. A grep of an empty directory returns nothing, and an empty answer is not
  "vanilla has no such entry".

  **Stage 2: write the mod.** Produce or modify a mod under `your_mods/<ModName>/`. Reuse
  `reference/example_mod/`. You may write only inside the bound mod directory. With no binding,
  call `create_mod_folder` with a `lower_snake_case` name, as the **Directory name** rule below
  defines it. Do not create a second binding when one already exists. The steps below say what to
  read before the first write.

  | # | Step | What you read or run | Output |
  | --- | --- | --- | --- |
  | 6 | **Read the conventions** | `docs/ck3-modding-conventions.md`, sections 1 to 3: override form, load order, localization | The rule list for this change |
  | 7 | **Choose the override form** | The same file, section 1: a full-file overwrite, a single-object override, or an additive new object | The form, and the reason for it |
  | 8 | **Write the files** | `reference/example_mod/` for the shape | The mod tree under `your_mods/<ModName>/` |
  | 8b | **Check the UI side** | The same file, section 3 for a label or a localization key, and section 7 when the change needs a menu entry, a column, a filter, or a panel. Reuse an existing in-game icon or asset when one fits. | The extra files, or a sentence that the change needs none |
  | 9 | **Validate, then review** | `validate_mod`, then `mod-reviewer` | Two verdicts, and every line handled |

  When you cannot dispatch, work through the last section of `docs/ck3-modding-conventions.md` by hand.

  Step 8b sits before step 9 on purpose. An icon or a localization key added after a clean receipt is
  covered by no check, and a localization file without a BOM fails in silence. When step 8b adds any
  file, run step 9 again after it.

  One ordering rule:
  1. Steps 6 and 7 are a gate, not a suggestion. A stage-2 wiki page explains a mechanism, and the conventions decide how the result may override vanilla. A correct block attached the wrong way still fails in the game.
- **Directory name** (this repository's rule, checked by the product's `create_mod_folder`). The name is
  `lower_snake_case`: it starts with a lowercase letter, then holds only lowercase letters, digits,
  and underscores, at most 40 characters. Do **not** use hyphens: `fix_inheritance`, not
  `fix-inheritance`. It must not be a Windows reserved device name: `con`, `prn`, `aux`,
  `nul`, `com1` to `com9`, and `lpt1` to `lpt9`.

## Searching the vanilla scripts

A search that lists files is cheaper than one that lists every matching line.

- **List files first.** Run `grep -rln <keyword> game-scripts/vanilla/game/`. Open the first file, then search inside it with `grep -n`.
- **Cap every listing.** One `head -20` per search. A long result means the keyword is too broad, so narrow it instead of raising the cap.
- **Read the shape from a sample.** `reference/example_mod/` holds a whole working mod. Never read `your_mods/` for an example.
- **The Workshop scripts are not vanilla.** A hit under `game-scripts/workshop/` proves what another player's mod does, not what the game accepts.
- **Values are not names.** A name or a scope comes from `docs/script_docs/`. A field value comes from the vanilla scripts.
- **A mod mirrors `game/` at its own root.** A data kind under `game-scripts/vanilla/game/common/` becomes a `common/` directory at the mod root.

Skip this section when the change sets values inside an existing block.

## Mod structure

```
<ModName>/
├── descriptor.mod          # required: key=value identity (name, version, …). See below.
├── thumbnail.png           # launcher and Workshop image (optional, may live only locally)
├── common/                 # game data, subdirectories mirror the game's layout
├── events/                 # event scripts
├── localization/           # localization/<lang>/*.yml
├── gfx/                    # graphics
└── gui/                    # interface
```

There is no `.metadata/` directory and no `in_game/`/`main_menu/` split: the content directories sit
directly at the mod root, mirroring the game's own `game/` directory.

## descriptor.mod

`descriptor.mod` is a **key=value text file** (not JSON), inside the mod directory. The launcher
discovers the mod through a separate `<name>.mod` pointer file that `install_mod` writes alongside
the directory. That file holds the same keys plus `path`.

```txt
version="1.0"
name="Inheritance Tweak"
supported_version="1.20.*"
tags={ "Gameplay" "Balance" }
picture="thumbnail.png"
```

`install_mod` uses the `your_mods/` directory name as the install directory name. Keep `name`
readable, but it need not match the directory name. The syntax and the rules for each field are in
`docs/ck3-modding-conventions.md` section 5. Read the version value from `get_game_info`, and write it
as a patch-level wildcard.

## Localization YAML

The files are `localization/<lang>/*.yml` at the mod root. Three things matter while you write:

- **Start the file with the BOM in the call that creates it.** A later rewrite drops the BOM, and the
  game then ignores the whole file in silence. That failure is fatal, not cosmetic. To add the BOM to
  a file that already exists:
  `printf '\xEF\xBB\xBF' | cat - <file> > tmp && mv tmp <file>`.
- **The filename ends with `_l_<language>`**, and it matches the language directory.
- **The first content line is `l_<lang>:`.** Each entry is `  key: "value"`.

The full format, the shipped languages, and the `replace/` directory are in
`docs/ck3-modding-conventions.md` section 3.

## The validate_mod tool

Call `validate_mod` with `modDir = your_mods/<ModName>/`.

- `PASS: <name> is valid - ...` then one `WARN: <file>: <message>` per warning. A `WARN` is
  advisory. When a name check could not run, the `PASS` line says so and a `NOTE` line names the
  missing input.
- `FAIL: <name> has N error(s)` then one `ERROR: <file>: <message>` per line, in English. Use the
  `NEXT:` line to locate the problem. Fix every ERROR, and do not modify another mod.
- A `NOTE:` line says that a check was skipped and why, for example when `docs/script_docs/` or the
  mirror is absent.

The tool checks three layers:

1. **Syntax and conventions:** balanced braces and quotes, the localization format, and the
   `descriptor.mod` fields. Files with any other suffix are skipped silently, and a `.yml` outside
   `localization/` is not read.
2. **The localization key of a new object:** a trait, a decision, or a character interaction.
3. **Effect, trigger, and modifier names, against the game's own dumps** in `docs/script_docs/`: a
   name that is one or two edits away from a real name is reported with the closest name. A name
   shorter than 8 characters is not compared.

It does **not** prove that a new name exists, and it is not a scope, type, or value validator. Section
9 of `docs/ck3-modding-conventions.md` states the exact coverage. Use `game-scripts/vanilla/game/` and
the wiki for scope and type. Use `how-to-speak` to report the result to the player.

## Common errors

Each `ERROR` line reads `ERROR: <file>: <message>`. The common ones, and the fix:

- `descriptor.mod: missing descriptor.mod`: create the file with the standard keys above.
- `descriptor.mod: name must be a non-empty string`: add `name="..."`.
- `descriptor.mod: version is required (a non-empty string)`: add `version="..."`. Any string works.
  `x.x` or `x.x.x` is a suggestion, not a rule.
- `missing UTF-8 BOM (game ignores localization files without a BOM)`: save the file as UTF-8
  **with BOM** (`EF BB BF`).
- `filename must end with '_l_<language>.yml'`: rename the file to `<name>_l_<language>.yml`.
- `unsupported localization language '<x>'. Accepted: ...`: the game does not ship that language. Use
  one of the shipped languages, or accept that the game ignores the file. Renaming it does not help.
- `expected a language header 'l_<lang>:' as the first content line`: the first content line must be
  `l_<lang>:`.
- `malformed localization line (expected '  key: "value"' or '  key:0 "value"')`: write
  `  key: "value"` with a closing double quote on the same line.
- `unbalanced braces` or `unbalanced '"'`: fix the brace balance or add the missing closing quote.

## Entry mechanisms and data kinds (what to add, and where it lives)

Pick the entry mechanism from the table in `docs/ck3-modding-conventions.md` section 7, then open the directory it names and read one of the examples there.

A mod can also add its own content to one of the game's own data directories. The list is mechanical,
and the modding context already holds it: usually one directory per data kind. On game version 1.20.1.1,
`game-scripts/vanilla/game/common/` holds 128 directories. To list them, run
`ls game-scripts/vanilla/game/common/`. Each directory entry names one data kind, and the count
changes when the game adds one.

These are the ones a content mod adds to most often. This is not the whole list:

| Kind | Directory |
| --- | --- |
| scripted effects | `common/scripted_effects/` |
| scripted triggers | `common/scripted_triggers/` |
| script values | `common/script_values/` |
| traits | `common/traits/` |
| modifiers | `common/modifiers/` |
| buildings | `common/buildings/` |
| decisions | `common/decisions/` |
| character interactions | `common/character_interactions/` |
| on actions | `common/on_action/` |
| scripted GUIs | `common/scripted_guis/` |
| activities | `common/activities/` |
| schemes | `common/schemes/` |

Open a vanilla file in that directory and read one real block's fields before you write. When a task
only changes values inside an existing block, there is no new definition to place.

## Reference

- A runnable sample, which must pass `validate_mod`: `reference/example_mod/`.
- Knowledge-layer navigation, and what to load when: `docs/INDEX.md`.
- The game overview: `docs/game.md`.
- The modding conventions, the single source of truth: `docs/ck3-modding-conventions.md`.

## Related skills

- The paths are not ready. Use `setup-workspace`. CK3 has no runtime to install.
- Getting the mod into the game, which uses the Paradox mod directory. Use `mod-installer`.
