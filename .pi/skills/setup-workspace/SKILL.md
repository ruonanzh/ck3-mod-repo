---
name: setup-workspace
description: Prepare the CK3 (pdx-script) environment and the paths. Locate the game directory, the mod install directory, and the Steam Workshop directory. Mirror the game's scripts and the `workshop/` scripts into `game-scripts/vanilla/` and `game-scripts/workshop/` as the modding context. Read it when a path is unknown or wrong, when the player gives a path to check, or on a new machine. CK3 has no runtime and no compilation.
---

# Environment and paths (CK3)

Get the facts straight, then record them: where the game is, what the three paths are, and whether
the modding context is ready.
**This step produces facts only.** It does not produce a mod.
Loading this skill does not grant write permission. In a consulting session you can explain the
method without recording anything.

CK3 mods are **pure PDXScript text**. There is no compilation, no runtime SDK, and **no runtime to
install**. This repository targets **Windows only** in v1.

## What is in `.gamer-agent.local.json`

`.gamer-agent.local.json` (**under this workspace directory**) is the single source of truth for path
state. The tools in `.pi/extensions/` read and write it. Fields:

| Key | Meaning | Source | Used by |
|---|---|---|---|
| `gameDir` | The game directory (`steamapps/common/Crusader Kings III`) | The player, or `try_set_game_dir` when it locates the game | `sync_game_scripts` mirrors the vanilla scripts from it. `install_mod` derives the install target from it. |
| `workshopDir` | The Steam Workshop directory (`steamapps/workshop/content/1158310`) | **Derived from `gameDir`**. There is no separate setter. | **Read-only reference.** Read the existing Workshop mods. It is **not involved in installing**. |
| `modInstallDir` | The Paradox launcher mod directory (`<userDocuments>/Paradox Interactive/Crusader Kings III/mod`) | **Computed from `mod-repo.json`'s `modInstall.path`**, independent of `gameDir` | `install_mod` copies the mod there. |

**The two derived paths need no separate setter.** Record `gameDir` correctly with `try_set_game_dir`
or `set_game_dir`, and the tool computes and records `workshopDir` and `modInstallDir` with it.

**Required compared with optional.** The tools require `gameDir` and `modInstallDir`. A wrong one
gives `FAIL`. `workshopDir` is a read-only reference and **never produces `FAIL`**, at most `WARN`.
This repository sets `workshop.supported = true` in `mod-repo.json`.

## Completion standard

**Account for all three paths before you stop.** `gameDir` and `modInstallDir` must be usable.
`workshopDir` is either usable, or you say explicitly "no Workshop directory found". It does not
affect installing, and the tools only read it. `try_set_game_dir` derives `workshopDir` from
`gameDir` and computes `modInstallDir` from the Paradox directory, so a correct `gameDir` records
all three.
**Do not stop after recording `gameDir` alone.**

## Tool split

Do not mix these tools up. They share one implementation in `.pi/lib/game-paths.ts`.

| Tool | What it does | Side effects |
|---|---|---|
| `try_set_game_dir` | **Ensure the game directory is ready.** No arguments, and idempotent. If the state is ready, it reports only. If the state is missing or stale, it locates the game and records the game directory and the two derived directories. | Writes path state, but only when it records. |
| `set_game_dir` | **Record one concrete game directory**, either from the player or one you found. It checks the path first, then records it. | Writes path state. |
| `check_game_paths` | **Check only.** Read-only. It checks the paths you give or the remembered ones, and it records nothing. | None. |
| `check_runtime` | **Report the runtime prerequisites only.** CK3 has none, so it always passes. It does **not** locate the game, and it does not touch the paths. | None. |
| `sync_game_scripts` | **Mirror the game's scripts and the Workshop scripts into `game-scripts/`**: `vanilla/` holds a copy of the game directory, and `workshop/` holds one directory per mod. This is the context you need before you write mods. | Writes `game-scripts/`. |

## How to use

- **You need the game location and the state is unknown or stale.** For the paths, run
  `try_set_game_dir` with no arguments. For the runtime, run `check_runtime`, which reports that CK3
  has none. Do not re-check on every turn once you have a valid result.
- **You cannot find the game directory.** `try_set_game_dir` looks for it. It reads the Windows
  registry and each Steam library's `libraryfolders.vdf`, then checks
  `steamapps/common/Crusader Kings III` against `binaries/ck3.exe`.
  **If it fails, continue yourself. Do not stop at the failure.**
  1. Turn the player's vague hints ("it is on D:", "in Steam", "the one I downloaded") into candidate
     directories. Check each one read-only with `check_game_paths`. Record the winner with
     `set_game_dir`.
  2. Ask the player only if step 1 fails. Use `how-to-speak` for the wording. Give a copyable entry
     point: Steam, Library, right-click the game, Manage, Browse local files. You can also ask the
     player to paste the path.
  **Do not** guess a path. **Do not** create a directory yourself.
- **The player gave a path.** Use `set_game_dir`. It checks the path first, then records it.
- **Before you write any mod, you must run `sync_game_scripts`** to mirror the game and Workshop
  scripts into `game-scripts/`. PDXScript has no self-describing API, so you cannot write correct
  PDXScript without this context. This step is **required**, and it is not a "find it when needed"
  step.
  For exact effect, trigger, and modifier names, grep `docs/script_docs/` for existence, grep
  `game-scripts/vanilla/game/` for the definitions, and use the official wiki for the concepts. The
  Workshop scripts are not vanilla: do not take a name from `game-scripts/workshop/` as evidence that
  the game accepts it.
- **Failures.** Follow the `NEXT` line the tool gives. When the same failure repeats, resolve the
  precondition instead of retrying.

## Related skills

- Writing or modifying the mod itself: the structure, metadata, localization, and LIOS/FIOS
  overrides. Use `mod-creator`.
- Getting the mod into the game. Use `mod-installer`.
