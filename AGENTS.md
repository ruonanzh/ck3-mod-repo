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
- **`supported_version` comes from `get_game_info`.** The field rules are section 5 of `docs/ck3-modding-conventions.md`.
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
  build they were dumped from, so they beat the wiki snapshot on the question "does this name exist". A game patch can make them stale. `node scripts/dump-script-docs.mjs` refreshes them. `mod-creator` and `mod-reviewer` say which file answers which question.
- `docs/data_types/` — the game's own GUI data types, promotes, and functions, five `data_types_*.txt`
  files. They are committed and exact for the build they were dumped from. `node scripts/dump-script-docs.mjs --command=dump_data_types` refreshes them.
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
  product UI. `editors/ck3_mod_descriptor/` edits `descriptor.mod`. `editors/ck3_mod_page/` opens a page under `your_mods/*/.preview/`, lets the player mark it, and saves the marks.
- `scripts/` — maintenance scripts, run by the maintainer, never by the agent during a mod task. `sync-wiki.mjs` refreshes the `docs/wiki/` pages and checks the hand-written `docs/wiki/INDEX.md`, and `dump-script-docs.mjs` asks the installed game for its name lists and its GUI data types. `check-doc-refs.mjs` checks every markdown link, and `test-mod-semantics.mjs` holds the semantic test cases. `scripts/README.md` lists the commands.
- `mod-repo.json` — the machine-readable game and environment declaration. `workshop.supported` declares whether this game has a Steam Workshop. The Workshop directory is not declared here: `try_set_game_dir` records it in `.gamer-agent.local.json`.
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

The rules and the reason for each one are in `docs/ck3-modding-conventions.md`. Sections 1 to 4 hold the override forms, the load order, the localization format, and the brace and quote rules.

- Write under `your_mods/<ModName>/`.
- Do not leave `temp_*`, `_tmp_*`, or editor backups in the mod directory.

## Who decides

- **The agent proposes.** When a direction or a player choice is still open, state one concrete example and what it changes in the game.
- **The player decides.** The design and its numbers go into the mod after the player agrees to them, in the way `mod-page` and `mod-creator` set out.

## Validation

Run `validate_mod` on `your_mods/<ModName>/` after you finish or change a mod, and clear every ERROR before you end the turn. Sections 4, 5, and 9 of `docs/ck3-modding-conventions.md` state what the tool checks and what it does not.

`mod-reviewer` reviews what `validate_mod` cannot see: the override form, the placement, the scope and type of each call, and the questions no file can settle. The caller dispatches it before `install_mod` and before reporting a mod as finished. It reads the receipt, so it does not repeat those checks.
