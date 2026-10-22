# CK3 mod workspace

**Crusader Kings III** (Paradox, Clausewitz/Jomini engine) modding environment.
Mods are pure PDXScript text files. There is no compilation and no runtime SDK.
This repository targets **Windows only** in v1 (the game itself runs on Windows, macOS, and Linux).

## Environment facts

These are fixed facts about this machine and this workspace. They prevent wasted turns.

- **Prefer `node` for scripts.** The product ships its own node, so every player machine has it.
  If `python --version` exits with `exit 49`, then `python` is the Microsoft Store stub, and it is a
  silent no-op. If python is truly needed, run `command -v py` first. If `py` is missing, fall back
  to `node` / `awk`.
- **When you develop, read scripts only from the vanilla scripts at `game-scripts/vanilla/game/`**
  (this does not affect mod runtime). The modding context copies the game directory, so the game's own
  `game/` directory appears once inside `vanilla/`. The real install directory
  `.../Crusader Kings III/game/...` is the source that `sync_game_scripts` reads to build that copy.
  Do not `cat` / `grep` there while developing. Installing a mod is a third place: `install_mod`
  writes to the Paradox launcher mod directory,
  `<user documents>/Paradox Interactive/Crusader Kings III/mod/`.
- **`supported_version` must point at the installed game.** Read it from `get_game_info` and write
  the patch-level wildcard that the tool returns. An exact version goes stale, and a loose wildcard
  is a WARN. The field rules are in section 5 of `docs/ck3-modding-conventions.md`.
- **One read-only subagent ships here:** `mod-reviewer`, under `.pi/agents/`. It does not write, so you apply every change. `mod-creator` says when to dispatch it.

## Directory map

- `docs/` — the knowledge layer. Start at [`docs/INDEX.md`](docs/INDEX.md) for the map.
  The modding conventions live **only** in
  [`docs/ck3-modding-conventions.md`](docs/ck3-modding-conventions.md). They cover override,
  load order, localization, and metadata.
  Every English text that an agent reads follows the CK3 writing standard: no semicolon, one word for
  one meaning, and the words in the glossary. The glossary is section 8 of the conventions file, and
  it is the list to check a term against.
- `game-scripts/` — the modding context. `sync_game_scripts` writes two parts, and git ignores the
  whole directory. `vanilla/` is a copy of the game directory, so the game's own scripts are at
  `vanilla/game/`. `workshop/` holds one directory per Workshop mod. This is what you must load
  before writing mods. The Workshop scripts are not vanilla. PDXScript has no self-describing API, so
  you cannot write a correct override without it.
- `docs/script_docs/` — the game's own name dumps: `effects.log`, `triggers.log`, `modifiers.log`,
  `event_scopes.log`, `event_targets.log`, and `on_actions.log`. They are committed and exact for the
  build they were dumped from, so they beat the wiki snapshot on the question "does this name exist",
  and a game patch can make them stale. `validate_mod` reads the first three. The other three are the
  reviewer's evidence: `on_actions.log` holds the on_action names, and the event scope files describe
  the scopes. `node scripts/dump-script-docs.mjs` refreshes them.
- `docs/data_types/` — the game's own GUI data types, promotes, and functions, five `data_types_*.txt`
  files. They are committed and exact for the build they were dumped from. Read the file that matches
  the window before you write a `.gui` override. `node scripts/dump-script-docs.mjs
  --command=dump_data_types` refreshes them.
- `.pi/skills/` — the step guidance: role skills `setup-workspace`, `mod-creator`, and `mod-installer`,
  plus `how-to-speak` (how to write anything the player reads) and `mod-page` (how to write a mod
  page, revise it from the player's marks, and when to answer a game mechanics or game content
  question with a reference page). Each skill describes its own scope and trigger. Pi keeps the
  descriptions in context, so read the matching skill. This repo's step guidance lives there, not in
  the product prompt.
- `.pi/extensions/` — the tools. Path tools: `try_set_game_dir`, `set_game_dir`, and
  `check_game_paths`. Info tool: `get_game_info` (reports the recorded paths, the version value, the
  state of the modding context and its Workshop mods, and whether the dumps are present).
  Runtime tools: `check_runtime` and `install_runtime` (CK3 has no runtime).
  Mod tools: `validate_mod` and `install_mod`. Context tool: `sync_game_scripts`. The product also
  provides `create_mod_folder`, which binds this session to one directory under `your_mods/`. Trust
  the capabilities and the side effects that each tool declares.
- `reference/` — read-only mod samples. `reference/example_mod/` is a runnable sample that passes
  `validate_mod`. `reference/README.md` describes it.
- `editors/` — the mod-page and descriptor editors. Each subdirectory is one editor, opened by the
  product UI. `editors/ck3_mod_descriptor/` edits `descriptor.mod`. `editors/ck3_mod_page/` edits
  the Steam Workshop page.
- `scripts/` — maintenance scripts, run by the maintainer, never by the agent during a mod task:
  `sync-wiki.mjs` refreshes `docs/wiki/`, `dump-script-docs.mjs` asks the installed game for its name
  lists and its GUI data types, and writes them into `docs/script_docs/` and `docs/data_types/`, and
  `check-doc-refs.mjs` checks every markdown link.
- `mod-repo.json` — the machine-readable game and environment declaration. `workshop.supported`
  declares whether this game has a Steam Workshop. `workshopDir` is a read-only reference and is
  not used for installing. The rule is in the `setup-workspace` skill.
- `your_mods/` — the mod output area. Write mods only here, as `your_mods/<ModName>/`.

## Runtime path record (`.gamer-agent.local.json`)

`.gamer-agent.local.json` (**under this workspace directory**) is the single source of truth for
path state. The tools in `.pi/extensions/` read and write it.
**Only trust the copy in this workspace.** The machine may have same-named files elsewhere, from
other clones or leftover state. Using those leads to wrong conclusions.
**"Ready" means the recorded values plus the tool result.** Seeing a directory with `ls` does not
mean that `.gamer-agent.local.json` records it. The workspace panel, `validate_mod`, `install_mod`, and
`sync_game_scripts` all read the recorded state.
Field meanings are in `.pi/skills/setup-workspace/SKILL.md`.

## Session roles and write boundary

The session sets one of two roles. The agent does not choose the role.

- **Q&A (Game Helper):** read-only. Answer game-mechanics and mod API questions from `docs/`.
  May run the read-only tools `check_game_paths`, `check_runtime`, `install_runtime`, and
  `validate_mod`. Must **not** write or edit any mod file, locate or record paths, or mirror the
  scripts into `game-scripts/`.
- **Mod development:** write only under `your_mods/<ModName>/`. The session role and binding decide
  whether writing is allowed and which mod directory is writable. This file does not decide that.
  Two tools write outside it by design: `sync_game_scripts` writes the modding context, and
  `install_mod` writes the mod install directory.

The repository owner maintains everything else (`docs/`, `.pi/`, `reference/`, `mod-repo.json`).
Do not write there.

## Boundaries before you write a mod

These are the boundaries. The rule and the reason for each one are in
`docs/ck3-modding-conventions.md`. Read sections 1 to 3 before the first write.

- Write under `your_mods/<ModName>/` only.
- Only a top-level declaration can be overridden, and a single-object override changes an object. It
  cannot delete one. Section 1 has the override forms and the GUI first-in-wins exception.
- Load order is ASCIIbetical. Section 2 has the prefix idioms.
- Localization is UTF-8 with BOM under `localization/`, and the filename carries the language.
  Section 3 has the format and the shipped languages.
- Keep `{` and `}` balanced, and keep `"` balanced. A `#` starts a line comment, and `#` is literal
  inside a string.
- Do not leave `temp_*` or `_tmp_*` scratch files, or editor backups, in the mod directory.

## Validation

After you finish or change a mod, run `validate_mod` on `your_mods/<ModName>/`.
Clear every ERROR before you end the turn.

The tool checks syntax, conventions, and names, when the modding context and the dumps are present:

- **Syntax and conventions:** balanced braces and quotes, the localization format, and the
  `descriptor.mod` fields.
- **A new object needs its localization key:** a trait, a decision, or a character interaction that
  the mod adds.
- **An effect, trigger, or modifier name must be one the game knows.** The check compares against the
  game's own dumps in `docs/script_docs/`, and it reports a name that is one or two edits away from a
  real one, with the closest name.

A `WARN` is advisory. A `PASS` does not prove that a new name exists. The tool is not a scope, type,
or value validator. Section 9 of `docs/ck3-modding-conventions.md` states the exact coverage and its
limits.

`mod-reviewer` reviews what `validate_mod` cannot see: the override form, the placement, the scope and
the type of each call, and the questions that only the game answers. Dispatch it before `install_mod`
and before you report a mod as finished. It reads the `validate_mod` receipt, so it does not repeat
those checks.

