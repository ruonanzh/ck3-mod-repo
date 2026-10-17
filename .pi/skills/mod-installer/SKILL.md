---
name: mod-installer
description: Install a CK3 mod into the Paradox mod directory with the `install_mod` tool. Covers the install directory name, in-place updates on a re-install, the `<directory name>_pimod` fallback for an occupied target, and the transactional replace. Also covers the steps that make the mod visible and enabled. Read it when the player wants the mod in the game, visible in the launcher, or updated.
---

# Install a mod into the game (CK3)

`install_mod` copies a mod into the **Paradox mod directory**
(`<userDocuments>/Paradox Interactive/Crusader Kings III/mod`).
The target comes from the `.gamer-agent.local.json` file that `try_set_game_dir` recorded. The tool
does not locate the game itself. If no path is recorded, run `try_set_game_dir` with no arguments
first.
A missing target directory is not an error. It is the normal state on a new machine, and the tool
creates it.

## Rules

- **The installed directory name equals the `your_mods/` directory name.** The `name` key in
  `descriptor.mod` is the display title and need not match the directory name. The directory name is
  therefore always a single path segment, so the tool cannot write outside the game directory. The
  player sees the same directory name in the launcher as in the workspace.
- **A re-install updates in place.** The tool identifies its own previous install through the
  workspace-side record `your_mods/<mod name>/.pi-mod.json`, which holds `name` and `installedDir`.
- **Another mod owns the target directory.** The tool does not overwrite it. It installs as
  `<directory name>_pimod` instead. It does not modify that copy's `descriptor.mod`. Tell the player
  the directory name that the tool used. The in-game title `name` stays the same.
- **The install path should be ASCII.** The engine reads a mod at a path with a non-ASCII character
  as having no files inside. `install_mod` does **not** refuse such a path: it installs, then returns a
  `WARN` that says the game may load the mod with no files. Report that warning to the player exactly
  as written. If the mod shows up but does nothing in the game, the fix is to move the mod install
  directory to an ASCII path (for example by relocating the Windows `Documents` folder), then run
  `try_set_game_dir` with no arguments and install again. Do not rename the mod. The rule is in
  `docs/ck3-modding-conventions.md` section 6.
- **The replace is transactional.** The tool moves the old copy aside instead of deleting it, and it
  deletes that copy only after the new copy lands. If the new copy fails, the old version is still
  there.

## Review before the install

Run `validate_mod` first, and clear every ERROR. Then dispatch `mod-reviewer` with the planned files
and the `validate_mod` receipt. It reports the semantics that `validate_mod` does not check, including
the effect, trigger, and modifier names and their scopes, which it resolves against `docs/wiki/`.

- `PASS`: install.
- `WARN`: tell the player the risk, then install.
- `FAIL`: correct the mod and run `validate_mod` again. The verdict does not block the install, so
  install only when the player agrees.

Skip this step when you write no script file.
When the `subagent` tool is not available, apply the six review classes in
`.pi/agents/mod-reviewer.md` by hand.

## After the install

An `install_mod` success does not mean the game loaded or enabled the mod. Report the three states
separately: copied into the mod directory, visible in the launcher, and active in the game.
The player must enable the mod in the launcher **playlist**. The three steps are in
`docs/game.md`, section "How the player enables a mod".

## Related skills

- The paths are not ready. Use `setup-workspace`. `try_set_game_dir` ensures the paths, and
  `check_game_paths` checks them without recording.
- The mod content itself: `descriptor.mod`, localization, and PDXScript. Use `mod-creator`.
