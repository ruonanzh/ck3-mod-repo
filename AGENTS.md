# CK3 mod workspace

**Crusader Kings III** (Paradox, Clausewitz/Jomini engine) modding environment.
Mods are pure PDXScript text files. There is no compilation and no runtime SDK.
The game is **Windows-only**.

## Environment facts

These are fixed facts about this machine and this workspace. They prevent wasted turns.

- **Prefer `node` for scripts.** The product ships its own node, so every player machine has it.
  On this machine `python` is a Microsoft Store stub: it exits with `exit 49`
  and is a silent no-op. If python is truly needed, run `command -v py` first. If `py`
  is missing, fall back to `node` / `awk`.
- **When you develop, read scripts only from the vanilla scripts at `game-scripts/`** (this does not affect mod
  runtime). The vanilla scripts live at `game-scripts/game/game/...` — **two** `game/`
  levels. The real install directory `.../Crusader Kings III/game/...` — **one** `game/` level —
  is the vanilla source that `sync_game_scripts` reads to build that copy. Do not `cat` / `grep`
  there while developing. Installing a mod is a third place: `install_mod` writes to the Paradox
  launcher mod directory, `<user documents>/Paradox Interactive/Crusader Kings III/mod/`.
- **`supported_version`: write a patch-level wildcard** (e.g. `1.20.*`). An exact
  version such as `1.20.1` goes stale. This game updates its minor version often, and the game flags
  an exact version as outdated. Do not take the easy way out with a loose `1.*` — the linter WARNs on it.
  Read it from `get_game_info`, as section 5 of `docs/ck3-modding-conventions.md` explains.
- **Two read-only subagents ship with this repository.** `.pi/settings.json` declares the vendored
  `pi-subagents` package at `.pi/vendor/pi-subagents/`, so the `subagent` tool is available in a
  trusted project. Prefer `entry-scout` over your own grep of `game-scripts/`. It runs in parallel,
  one per question, and its searches stay in the child session, so your context holds answers, not
  greps. Read its first candidate yourself. `mod-reviewer` checks the semantics that `validate_mod`
  cannot see, before you install. Neither writes, so you apply every change. When you cannot
  dispatch, run the search yourself, and work through the last section of
  `docs/ck3-modding-conventions.md` by hand.

## Directory map

- `docs/` — the knowledge layer. Start at [`docs/INDEX.md`](docs/INDEX.md) for the map.
  The modding conventions live **only** in
  [`docs/ck3-modding-conventions.md`](docs/ck3-modding-conventions.md). They cover override,
  load order, localization, and metadata.
- `game-scripts/` — the vanilla scripts. `sync_game_scripts` copies them and the
  `workshop/` scripts into it, and git ignores it. This is the modding context you must load
  before writing mods. PDXScript has no self-describing API, so you cannot write a correct override
  without it.
- `.pi/skills/` — the step guidance: role skills `setup-workspace`, `mod-creator`, and `mod-installer`,
  plus `how-to-speak` (how to write anything the player reads) and `mod-page` (how to write a mod
  page, revise it from the player's marks, and when to answer a game mechanics or game content
  question with a reference page). Each skill describes its own scope and trigger. Pi keeps the
  descriptions in context, so read the matching skill. This repo's step guidance lives there, not in
  the product prompt.
- `.pi/extensions/` — the tools. Path tools: `try_set_game_dir`, `set_game_dir`, and
  `check_game_paths`. Runtime tools: `check_runtime` and `install_runtime` (CK3 has no runtime).
  Mod tools: `validate_mod` and `install_mod`. Context tool: `sync_game_scripts`. Trust the
  capabilities and the side effects that each tool declares.
- `reference/` — read-only mod samples. `reference/example_mod/` is a runnable sample that passes
  `validate_mod`. `reference/README.md` maps the real-world pattern mods.
- `mod-repo.json` — the machine-readable game and environment declaration. `workshop.supported`
  declares whether this game has a Steam Workshop. `workshopDir` is a read-only reference and is
  not used for installing. The rule is in the `setup-workspace` skill.
- `your_mods/` — the mod output area. Write mods only here, as `your_mods/<ModName>/`.

## Runtime state file

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
- **The subagents never write.** `entry-scout` and `mod-reviewer` hold `read` and `grep` only.
  Their results are advice. They are not session roles. Any session may
  dispatch them.

The repository owner maintains everything else (`docs/`, `.pi/`, `reference/`, `mod-repo.json`).
Do not write there.

## Checklist before you write a mod

Keep these in mind while you write a mod. They prevent most `validate_mod` failures.

- Keep `{` and `}` balanced. Keep `"` balanced. A `#` starts a line comment, and `#` is literal
  inside a string.
- To override a vanilla file, use the same path and filename. To override one object, put a new
  file in the same folder with a later ASCIIbetical name (`01_defines.txt` wins over `00_defines.txt`).
  GUI `type`/`template` clashes resolve in the opposite order (first in wins), so name the file early
  (`00_my_buttons.gui`).
- Use load-order prefixes so an override loads after its target: `00_` early, and `zz_`, `98_`, or
  `99_` late.
- Localization YAML must be UTF-8 **with BOM**. The filename must end with `_l_<language>`. The
  first line must be `l_<lang>:`. Each entry is `key: "value"`.
- Do not leave `temp_*` or `_tmp_*` scratch files, or editor backups, in the mod directory.

## Validation

After you finish or change a mod, run `validate_mod` on `your_mods/<ModName>/`.
Clear every ERROR before you end the turn.
The tool checks syntax and conventions: balanced braces and quotes, the localization format, and the
`descriptor.mod` fields. It does **not** check effect, trigger, or modifier names, and it is not a
scope or type validator — use `game-scripts/` and the wiki for those.

`mod-reviewer` reviews the override and metadata consistency that `validate_mod` cannot see. Dispatch
it before `install_mod` and before you report a mod as finished. It reads the `validate_mod` receipt,
so it does not repeat those checks.

