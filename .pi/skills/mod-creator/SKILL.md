---
name: mod-creator
description: The guide for writing and modifying CK3 (pdx-script) mods. Always read it first, before you search the vanilla scripts, before you read the reference mods, and before your first write. Covers the order of work, the mod structure, the `descriptor.mod` fields, localization YAML, PDXScript and GUI syntax, LIOS/FIOS overrides, load order and naming, the entry mechanisms, `validate_mod` errors, and the vanilla lookup path.
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
  knowledge layer. Start from `docs/INDEX.md` to locate the right source. Do **not**
  create files or prepare the environment, unless the player explicitly asks about their
  environment. Preparing the environment means locating paths and mirroring the scripts into
  `game-scripts/`.
- **Writing or modifying the mod.** Run this pipeline, in this order. It exists because CK3 is pure
  PDXScript with no self-describing API: the mechanism is documented, the entry is in the vanilla
  scripts, and the call form is in the lists. Skipping a stage produces a plausible file that fails in
  the game.

  | # | Stage | What you read or run | Output |
  | --- | --- | --- | --- |
  | 1 | **Map the request to a page** | `docs/wiki/INDEX.md` — one row per wiki page, with `Local yes/no` | The one page that covers "how do I add X" (`Holdings_modding` for a building, `Event_modding` for an event, …) |
  | 2 | **Read the mechanism** | That page's own table of contents, then only the section the request needs | The required block, its fields, and where the file goes |
  | 3 | **Locate the entry in vanilla** | Two **peer** options: grep `game-scripts/` yourself, or dispatch `entry-scout`. Prefer `entry-scout`: it runs in parallel and its greps stay in the child session. Add `reference/example_mod` for a whole shape. | Real object names, real field values, and the file to mirror |
  | 4 | **Check the call form** | `docs/wiki/Effects_list.md`, `Triggers_list.md`, `Modifier_list.md`, `Scopes_list.md`, and `game-scripts/script-docs/*.log` when it exists | The parameters and the scope of every call you are about to write |
  | 5 | **Agree, then read the conventions, then write, then verify** | The player. Then `docs/ck3-modding-conventions.md`, section 1 and section 2 of that file: override form and load order. Then `validate_mod`. | A mod that passes, and a plain report of what was not checked |

  Stage 1 is yours, not the scout's: choosing the mechanism is a decision, and `entry-scout` answers
  "where is this name" only. When the request spans two kinds (a decision plus its event), run stages
  1–2 once per kind and stage 3 once for all of them: send all the scouts at once.

  Three hard ordering rules inside stages 3–5:
  1. For a player-worded feature request, name the question shape first. Then locate the entry with
     either option: a grep of `game-scripts/` or a dispatched `entry-scout`. **The two are peers,
     and `entry-scout` is preferred**, because it runs in parallel, one per question, and its searches
     stay in the child session, so your context holds answers, not greps. Grep yourself when you
     already know the exact name and one or two calls settle it (`grep -rln <keyword> game-scripts/`),
     or when you cannot dispatch. Always read the scout's first candidate yourself. The
     `## Locate the entry: scout or grep` section below has the details.
  2. Read in this fixed order: `docs/ck3-modding-conventions.md` (the single source of truth),
     then `reference/example_mod`, then write. **This is a gate, not a suggestion:** a stage-2 wiki
     page explains a mechanism, and the conventions decide how the result may override vanilla. A
     correct block attached the wrong way still fails in the game, and `validate_mod` cannot see it.
  3. Decide the screen first, then research how to mount on that one screen. Where a mechanism
     lives and where to attach something inside an existing screen are two different questions.
     Section 7 of the conventions answers the first. For the second, read that screen's own
     `.gui` file and find the block to override.

  **Agree with the player before you write.** Give a short description of the mod content: what it
  modifies, its scope, and the shape of the mod. Then wait for the player's confirmation. Do this
  **even when the request looks specific**. Skip it only when the player explicitly says to start,
  for example "start now, no confirmation".

  **Then write.** Produce or modify a mod under `your_mods/<ModName>/`. Reuse
  `reference/example_mod/`. You may write only inside the bound mod directory. With no binding,
  call `create_mod_folder` with a `lower_snake_case` name, as the **Directory name** rule below
  defines it. Do not create a second binding when one already exists.

  **Then check the UI side.** A mod here is mostly PDXScript code, but an in-game check often
  fails without the UI part. Before you finish, ask: does this modification need an icon, a UI
  label (localization), a menu entry, a column, a filter, or a panel? Add what is missing. Reuse
  an existing in-game icon or asset when one fits, because you do not have to create new art. Do
  not wait for the player to ask about the icon.
- **Directory name** (this repository's rule, enforced by `create_mod_folder`). The name is
  `lower_snake_case`: it starts with a lowercase letter, then holds only lowercase letters, digits,
  and underscores, at most 40 characters. Do **not** use hyphens: `fix_inheritance`, not
  `fix-inheritance`. It must not be a Windows reserved device name: `con`, `prn`, `aux`,
  `nul`, `com1` to `com9`, and `lpt1` to `lpt9`.

## Locate the entry: scout or grep

Stage 3 asks one question: where does vanilla already do this? Two tools answer it, and they are
peers.

**Prefer `entry-scout`.** It runs in parallel, one per question, and its greps stay in the child
session, so your context holds the answers, not the searches. Its answer is a candidate list, not a
decision: read its first candidate yourself before you write.

**Grep yourself** when you already know the exact name and one or two calls settle it:
`grep -rln <keyword> game-scripts/`. Also grep yourself when you cannot dispatch, for example when
the subagent tool is unavailable.

When the change has two or three independent parts, send all the scouts at once, one per part.

Skip this step when the task only changes values inside an existing block.

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

Standard keys:

| Key | Rule |
|---|---|
| `name` | A non-empty string: the mod title that the player reads. |
| `version` | A non-empty string. `x.x` or `x.x.x` is a good habit, and the game accepts `1` as well. |
| `supported_version` | A patch-level wildcard, for example `1.20.*`. An exact version such as `1.20.1` goes stale: this game updates its minor version often, and the game then flags the mod outdated. A loose `1.*` is a WARN. |
| `tags` | A list of quoted strings: `tags={ "Gameplay" "Balance" }`. It may span several lines. |
| `picture` | `"thumbnail.png"`, pointing at the image at the mod root. |
| `replace_path` | Optional: skips the vanilla files at a path. |

```txt
version="1.0"
name="Inheritance Tweak"
supported_version="1.20.*"
tags={ "Gameplay" "Balance" }
picture="thumbnail.png"
```

Syntax: `key="value"` for scalars, `key={ "a" "b" }` for lists, and `#` starts a single-line
comment. A list may span several lines, and real workshop mods write `tags` that way. `install_mod`
uses the `your_mods/` directory name as the install directory name. Keep
`name` readable but it need not match the directory name.

## Localization YAML

The files are `localization/<lang>/*.yml` at the mod root.

- **Write the file as UTF-8 with BOM** (`EF BB BF`) in the call that creates it: start the content
  with the BOM character. A later rewrite of the file drops the BOM, and the game then ignores the
  file in silence. That failure is fatal, not cosmetic. To add the BOM to a file that already
  exists, use: `printf '\xEF\xBB\xBF' | cat - <file> > tmp && mv tmp <file>`.
- The filename must end with `_l_<language>`, which matches the language directory.
- **The game ships 9 languages:** `english`, `french`, `german`, `japanese`, `korean`, `polish`,
  `russian`, `simp_chinese`, `spanish`. Another language is an ERROR that names it and the accepted
  set. Renaming the file cannot fix it.
- The first content line is `l_<lang>:`, and it must match the directory.
- An entry is `  key: "value"` or `  key:0 "value"` with an explicit version (the `:0` version is
  deprecated/no-op). The value starts and ends with a double quote on the same line, so an inner `"`
  and a doubled `""` are legal. A value with no closing `"` on its line is an error. Keep the `[`
  and `]` placeholders balanced.
- One file must not hold duplicate keys.
- To override a vanilla loc key, use a `replace/` subdirectory:
  `localization/replace/<lang>/overwriting_l_<lang>.yml`. Keys there overwrite identical keys
  elsewhere. (`localization/<lang>/replace/` also works, but `localization/replace/<lang>/` takes
  precedence.)

## PDXScript and GUI

The `.txt`, `.gui`, `.gfx`, and `.asset` files sit under the content folders at the mod root.

- The encoding is UTF-8. Keep the `{` and `}` balanced, and keep the `"` balanced. A `#` starts a
  line comment outside a string, and `#` is literal inside a string. A GUI string can span several
  lines.

## Overriding vanilla

There is **no** `INJECT:`/`REPLACE:` keyword system in CK3. Override is file- and object-based. The
reason and the edge cases are in `docs/ck3-modding-conventions.md`
§1.

1. **Full file overwrite.** A file with the same path and filename replaces the vanilla file
   entirely. This is brittle.
2. **Single-object override (script data).** A new file in the same directory with a later
   ASCIIbetical name redefines an object — "Last In Only Served" (LIOS): `01_defines.txt` wins over
   `00_defines.txt`.
3. **GUI `type`/`template` is the opposite — First In Only Served (FIOS).** Name the file to sort
   first, e.g. `00_my_buttons.gui`.
4. **`on_actions`:** `events`, `random_events`, and `on_actions` append. A `trigger` or `effect`
   overwrite (and produce errors).
5. **Only a top-level declaration can be overridden:** it starts at the beginning of a line and is not
   inside a block. A nested field is not a target.
6. **A single-object override can change an object, but it cannot delete one.** Delete needs a whole
   file replacement.

**Rule of thumb.** Prefer additive new objects. Use a later ASCIIbetical filename for a surgical
object override, and reserve a full-file overwrite for a change to most of a file.

## Load order and naming

- Files load in **ASCIIbetical order**: `00_foo.txt` before `01_bar.txt`. (A file in a subdirectory
  loading after the parent directory's files is **not yet verified for CK3** — treat it as "likely".)
- Prefix idioms: `00_` forces an early load, and `zz_`, `98_`, or `99_` forces a late load, so an
  override wins.
- **GUI exception.** A `type` or `template` clash resolves by **first in wins** (FIOS), so name the
  file early (`00_my_buttons.gui`), not late.
- The mod directory name is `lower_snake_case`. Do not leave scratch files in the mod directory:
  `temp_*`, `_tmp_*`, and editor backups.

## The validate_mod tool

Call `validate_mod` with `modDir = your_mods/<ModName>/`.

- `PASS: <name> is valid` means the static syntax and convention checks passed. It does not mean the
  mod ran in the game.
- `FAIL: <name> has N error(s)` then one `ERROR: <file>: <message>` per line, in English. Use the
  `NEXT:` line to locate the problem. Fix every ERROR, and do not modify another mod.
- The tool checks syntax and conventions: balanced braces and quotes, the localization format, and
  the `descriptor.mod` fields. It does **not** check effect, trigger, or modifier names, and it is
  not a scope or type validator. Use `game-scripts/` and the wiki for those. Use `how-to-speak` to
  report the result to the player.

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
  one of the nine, or accept that the game ignores the file. Renaming it does not help.
- `expected a language header 'l_<lang>:' as the first content line`: the first content line must be
  `l_<lang>:`.
- `malformed localization line (expected '  key: "value"' or '  key:0 "value"')`: write
  `  key: "value"` with a closing double quote on the same line.
- `unbalanced braces` or `unbalanced '"'`: fix the brace balance or add the missing closing quote.

## Entry mechanisms and data kinds (what to add, and where it lives)

Pick the entry mechanism from the table in `docs/ck3-modding-conventions.md` section 7, then open the
directory it names and read one of the examples there. Send the intent to `entry-scout` first and read
the candidate it returns, in two cases: when you are unsure which mechanism fits, and when you must
survey the mechanisms that the game already has for a feature.

A mod can also add its own content to one of the game's own data folders. The common ones are:

| Kind | Folder |
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

## Vanilla lookup path

For the question "does X exist, and what is the vanilla value?", follow the lookup hierarchy in
`docs/INDEX.md`. It is the single authoritative map of which source to use.

- Exact vanilla object definitions, field values, and loc keys: `game-scripts/game/game/`, which
  `sync_game_scripts` generates. This path has two `game/` levels, because the mirror copies the
  whole install directory. Do not grep the install directory itself.
- **The parameters and the scope of one effect, trigger, modifier, or scope:** `docs/wiki/`. The
  vanilla scripts show **usage**, which means the name appears somewhere. `docs/wiki/Effects_list.md`,
  `Triggers_list.md`, `Modifier_list.md`, and `Scopes_list.md` show the **fields and the scope they
  need**. Read the list entry before you write a call you have not seen in vanilla. `docs/wiki/` is
  a snapshot: it states its own age, so check the vanilla file when the two disagree.
- Script language rules (syntax, scopes, variables, iterators, templates): `docs/wiki/Scripting.md`.
- Mechanics concepts: the official wiki (ck3.paradoxwikis.com). The modding conventions and the
  reason behind them: `docs/ck3-modding-conventions.md`.

Locate it with either option, which are peers: dispatch `entry-scout`, or grep yourself. **Prefer the
scout**, because it runs in parallel and returns candidates as `file:line` without spending your
context. Give it the intent and the planned change list. Its answer is a candidate list, not a
decision: read its first candidate yourself before you write.
When you cannot dispatch, run the search yourself along the same path.

## Reference

- A runnable sample, which must pass `validate_mod`: `reference/example_mod/`.
- Knowledge-layer navigation, and what to load when: `docs/INDEX.md`.
- The game overview: `docs/game.md`.
- The modding conventions, the single source of truth: `docs/ck3-modding-conventions.md`.

## Related skills

- The paths are not ready. Use `setup-workspace`. CK3 has no runtime to install.
- Getting the mod into the game, which uses the Paradox mod directory. Use `mod-installer`.
