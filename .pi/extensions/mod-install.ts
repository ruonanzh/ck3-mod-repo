import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { checkModInstallDir, effectiveModInstallDir, readModRepoConfig, readState, supportedGameVersion, writeState } from "../lib/game-paths";
import { readModIdentity } from "../lib/mod-identity";

/**
 * install_mod - the CK3 (pdx-script) install contract.
 *
 * It copies your_mods/<ModName>/ into the mod install directory, which is the modInstallDir value in
 * .gamer-agent.local.json. try_set_game_dir writes that value, and this tool does not search for the
 * directory itself.
 *
 * A name clash: when another mod occupies the target directory, the tool installs under a new name,
 * `<directory name>_pimod`. A further clash adds a number: `<directory name>_pimod2`, then
 * `<directory name>_pimod3`. The tool never overwrites another mod's content, and it never blocks
 * the install.
 *
 * Two mods with the same identity in the game is a mod conflict, and it is not the job of the
 * installer. The installer copies files only, and it does not change mod content such as the
 * descriptor.mod in the copy.
 *
 * Ownership and idempotency come from the workspace-side record
 * `your_mods/<mod name>/.pi-mod.json`, which holds `{ name, installedDir }`:
 *   - The installedDir in the record exists: update in place, so a re-install is idempotent.
 *   - The tool finds no record, or the recorded directory is absent. It then treats the mod as not
 *     installed, and derives the target from the your_mods directory name.
 *   - The target exists and it is not the recorded one: another mod owns it. Install as
 *     `<directory name>_pimod`, and never overwrite.
 *
 * The game directory holds no files of ours. All ownership information lives in the workspace.
 */

/** Files local to the workspace. They do not go into the game. */
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".preview"]);
const EXCLUDED_FILES = new Set([".DS_Store", ".pi-mod.json"]);

/** The workspace-side install record for one mod. */
export interface ModInstallRecord {
  name?: string;
  installedDir?: string;
}

const RECORD_FILE = ".pi-mod.json";

/**
 * The install record on the workspace side: `your_mods/<mod name>/.pi-mod.json`, which holds
 * `{ "name": <mod identity>, "installedDir": <installed directory name> }`.
 *
 * Ownership and idempotency read this record, and the game directory holds no files of ours. When
 * the recorded directory does not exist, treat the mod as not installed. The tool does not rebuild
 * and does not reconcile.
 */
export function readInstallRecord(modDir: string): ModInstallRecord | null {
  const recordPath = join(modDir, RECORD_FILE);
  if (!existsSync(recordPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(recordPath, "utf8")) as ModInstallRecord;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function writeInstallRecord(modDir: string, name: string, installedDir: string): void {
  const recordPath = join(modDir, RECORD_FILE);
  const tmp = `${recordPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ name, installedDir }, null, 2)}\n`);
  renameSync(tmp, recordPath);
}

/** Scans the other mod records under the workspace your_mods/: which one says "I installed to <directory name>". */
export function workspaceOccupantOf(yourModsRoot: string, dirName: string): string | null {
  for (const entry of existsSync(yourModsRoot) ? readdirSync(yourModsRoot, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue;
    if (readInstallRecord(join(yourModsRoot, entry.name))?.installedDir === dirName) return entry.name;
  }
  return null;
}

/** Scans the other mod records in the workspace: does another mod claim the same identity. */
export function workspaceSameIdentityAs(
  yourModsRoot: string,
  selfDirName: string,
  identity: string,
): string | null {
  for (const entry of existsSync(yourModsRoot) ? readdirSync(yourModsRoot, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || entry.name === selfDirName) continue;
    if (readInstallRecord(join(yourModsRoot, entry.name))?.name === identity) return entry.name;
  }
  return null;
}

/**
 * Picks the directory to install into.
 * - `modName`: the candidate directory name, from your_mods. It is one path segment, and it is
 *   already checked. It decides the target.
 * - `recordedDir`: the installedDir in this mod's workspace record, as an absolute path, or null. It
 *   answers whether the target is this mod's previous install.
 * - `yourModsRoot`: the root to scan for other mod records. It answers which mod of yours owns the
 *   target.
 *
 * A recorded target is updated in place, so two copies never remain. When another mod owns the
 * target, the tool adds a suffix: `<name>_pimod`, then `<name>_pimod2`.
 */
export function pickInstallDir(
  modRoot: string,
  modName: string,
  recordedDir: string | null,
  yourModsRoot: string,
): {
  dir: string;
  renamed: boolean;
  occupiedBy: string | null;
  reused: boolean;
} {
  const primary = join(modRoot, modName);
  // Ownership reads the workspace record. It no longer reads a file in the game directory.
  const free = (dir: string) =>
    !existsSync(dir) || (recordedDir !== null && resolve(dir) === resolve(recordedDir));
  if (free(primary))
    return {
      dir: primary,
      renamed: false,
      occupiedBy: null,
      reused: existsSync(primary),
    };

  const occupiedBy = workspaceOccupantOf(yourModsRoot, basename(primary));
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(modRoot, `${modName}_pimod${suffix === 1 ? "" : suffix}`);
    if (free(candidate))
      return {
        dir: candidate,
        renamed: true,
        occupiedBy,
        reused: existsSync(candidate),
      };
  }
}

/** Copies the mod files, and skips the files local to the workspace. */
export function copyModFiles(from: string, to: string): number {
  let count = 0;
  const walk = (srcDir: string, destDir: string) => {
    mkdirSync(destDir, { recursive: true });
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(join(srcDir, entry.name), join(destDir, entry.name));
        continue;
      }
      if (
        EXCLUDED_FILES.has(entry.name) ||
        entry.name.endsWith("~") ||
        entry.name.endsWith(".swp")
      )
        continue;
      cpSync(join(srcDir, entry.name), join(destDir, entry.name));
      count += 1;
    }
  };
  walk(from, to);
  return count;
}

/** Read mod-repo.json and never throw. A missing or unreadable file leaves the recorded path as the only source. */
const readCfgForTarget = (cwd: string): ReturnType<typeof readModRepoConfig> | null => {
  try {
    return readModRepoConfig(cwd);
  } catch {
    return null;
  }
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "install_mod",
    label: "Install Mod",
    description:
      "Copies a mod from your_mods/<ModName>/ into the mod install directory, which is the modInstallDir value in .gamer-agent.local.json. Re-installing the same mod updates it in place. When another mod occupies the target directory, the tool installs as <directory name>_pimod instead of overwriting it. The tool does not validate, does not compile, and does not edit mod content.",
    promptSnippet: "Install mod into the mod install directory",
    promptGuidelines: [
      "Use install_mod after validate_mod passes, so the player can enable the mod in the launcher.",
      "If install_mod reports the mod as <directory name>_pimod, tell the player two facts. The other mod in that directory was left untouched. This mod's files, including its descriptor.mod name, are unchanged.",
      "If install_mod returns a WARN about a non-ASCII install path, read it to the player: the install succeeded and the launcher will list the mod, but the game may load it with no files. Give the path fix from the WARN, and do not claim the mod works in the game.",
    ],
    parameters: Type.Object({
      modDir: Type.String({
        minLength: 1,
        description:
          "Mod directory, absolute or relative to the workspace root, for example your_mods/my_mod",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!params.modDir?.trim())
        throw new Error(
          "INVALID_MOD_DIR: Provide a mod directory, for example your_mods/my_mod.",
        );
      const modDir = resolve(ctx.cwd, params.modDir);
      if (!statSync(modDir, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(
          `INVALID_MOD_DIR: ${modDir} is not a directory. Check the session's bound path or build the mod first.`,
        );
      }

      // The target comes from the record that try_set_game_dir writes. install_mod does not search.
      // The state read goes through the lib, which check_game_paths and try_set_game_dir share. Do
      // not parse the JSON here. The derived path wins over the recorded one, because the player
      // can move the Documents directory after the tool recorded it, and a stale record would send
      // the mod to a directory that the launcher does not read.
      const target = effectiveModInstallDir(ctx.cwd, readCfgForTarget(ctx.cwd));
      let modRoot = target.dir;
      if (!modRoot) {
        return {
          content: [
            {
              type: "text",
              text: "FAIL: mod install directory unknown (no usable modInstallDir in .gamer-agent.local.json).\nNEXT: run try_set_game_dir with no arguments to locate the mod install directory, then run install_mod again.",
            },
          ],
          details: { ok: false, reason: "TARGET_NOT_FOUND" },
        };
      }
      // Repair the record when the derived path differs, so the next tool reads the right directory.
      if (target.corrected) writeState(ctx.cwd, { modInstallDir: modRoot });
      // A missing target directory is the normal state on a new machine, because the Paradox
      // launcher and the game have not run yet. It is not an error, so continue. The mkdirSync call
      // below creates the target together with any missing parent.
      // The old behavior demanded an existing target. try_set_game_dir reported the install as
      // possible, install_mod then failed on the missing target, and a later check still created
      // nothing, which looped forever.
      // The tool still rejects two cases: a path that is not absolute, and a path that exists but is
      // not a directory. To continue would only raise a less clear error later, in cpSync or
      // renameSync.
      // The target check is shared with check_game_paths and try_set_game_dir, in lib/game-paths.
      // The mod directory is in the Paradox launcher directory, which is independent of the game
      // location. The check is therefore a shape check: an absolute path, not a file, and the
      // relative path that mod-repo.json declares at the end. A missing directory is still the
      // normal state, and the install creates it.
      // The shape check needs mod-repo.json. When the file is unreadable, degrade to the absolute
      // path check and the not-a-file check, and do not fail the install.
      let cfgForPaths;
      try {
        cfgForPaths = readModRepoConfig(ctx.cwd);
      } catch {
        cfgForPaths = undefined;
      }
      // The non-ASCII path is reported, not refused. The player may not be able to change the
      // directory, and the launcher still lists the mod through the pointer file; only the game may
      // read it as empty. Refusing would leave the player with nothing, so install and say so.
      const targetVerdict = checkModInstallDir(modRoot, cfgForPaths);
      if (!targetVerdict.ok) {
        const code = targetVerdict.code ?? "TARGET_INVALID";
        return {
          content: [
            { type: "text", text: `FAIL: ${code}: ${targetVerdict.reason}\nNEXT: ${targetVerdict.next}` },
          ],
          details: { ok: false, reason: code },
        };
      }
      const asciiWarning = targetVerdict.warning ?? null;
      const targetWasMissing = !statSync(modRoot, { throwIfNoEntry: false });

      const identity = readModIdentity(modDir);
      if (!identity) {
        return {
          content: [
            {
              type: "text",
              text: `FAIL: ${modDir} has no usable descriptor.mod (name is required).\nNEXT: run validate_mod on this mod directory and fix the reported problems before installing.`,
            },
          ],
          details: { ok: false, reason: "MISSING_METADATA" },
        };
      }

      // The install directory name is the directory name under your_mods, and not the name from the
      // descriptor.mod:
      //   - basename always gives one path segment, so the path cannot escape the install root. The
      //     old version built the path from the mod name, and a name with "../" could write
      //     outside the install root.
      //   - create_mod_folder already checked the directory name against the rules: lowercase
      //     snake_case, the length limit, and the reserved names.
      //   - The player sees the same directory name in the launcher as in the workspace.
      const modName = basename(modDir);

      // The previous replace crashed between moving the old version aside and moving the new one in.
      // The target is then missing, and a .previous-* directory sits beside it. Do not delete that
      // state as junk. Restore it first.
      if (existsSync(modRoot))
        for (const entry of readdirSync(modRoot)) {
          if (entry.startsWith(`${modName}.previous-`) && !existsSync(join(modRoot, modName))) {
            renameSync(join(modRoot, entry), join(modRoot, modName));
          }
        }

      const record = readInstallRecord(modDir);
      const recordedDir =
        typeof record?.installedDir === "string" && record.installedDir
          ? join(modRoot, record.installedDir)
          : null;
      const yourModsRoot = join(ctx.cwd, "your_mods");
      const { dir: installDir, renamed, occupiedBy, reused } = pickInstallDir(
        modRoot,
        modName,
        recordedDir,
        yourModsRoot,
      );

      // The same mod, with the same identity in the record, was installed under another directory
      // name before. Report that, and do not delete it.
      // The scan is necessary only when the identity differs from the directory name. When they are
      // equal, the directory name of the previous install is necessarily this target.
      // pickInstallDir then resolves the re-install or the clash on that target. One mod in two
      // directories is therefore impossible.
      // The common path therefore has no O(n) scan, and a mod whose identity differs from its
      // directory name still receives that report.
      const duplicateDir =
        identity.name !== modName ? workspaceSameIdentityAs(yourModsRoot, modName, identity.name) : null;

      const staging = `${installDir}.staging-${process.pid}`;
      const previous = `${installDir}.previous-${process.pid}`;
      rmSync(staging, { recursive: true, force: true });
      rmSync(previous, { recursive: true, force: true });
      let files = 0;
      try {
        files = copyModFiles(modDir, staging);
        // The tool no longer writes any file of ours into the installed copy. Ownership moved to the
        // workspace-side record `your_mods/<mod name>/.pi-mod.json`. The game directory holds the
        // game's own files only.

        // A transactional replace. Rename the old version aside, and do not delete it. Move the new
        // version in, and delete the old one only after that succeeds. When the move fails, move the
        // old version back. The old version called rmSync first and renameSync second, and a failure
        // between them lost both copies.
        const hadPrevious = existsSync(installDir);
        if (hadPrevious) renameSync(installDir, previous);
        try {
          renameSync(staging, installDir);
        } catch (error) {
          if (hadPrevious) renameSync(previous, installDir);
          throw error;
        }
        if (hadPrevious) rmSync(previous, { recursive: true, force: true });
        // Write the record only after a successful install. The record does not take part in the
        // "is it installed" decision.
        writeInstallRecord(modDir, identity.name, basename(installDir));
        // Delete the old marker from the installed copy, for compatibility with earlier versions.
        rmSync(join(installDir, ".pi-mod.json"), { force: true });
      } catch (error) {
        rmSync(staging, { recursive: true, force: true });
        return {
          content: [
            {
              type: "text",
              text: `FAIL: copy failed: ${error instanceof Error ? error.message : String(error)}\nNEXT: check write permission on ${modRoot}. The previously installed copy, if any, is still in place, and the workspace record was not updated.`,
            },
          ],
          details: { ok: false, reason: "COPY_FAILED" },
        };
      }

      // Write the launcher pointer file `<installedName>.mod` next to the installed directory. The
      // CK3 launcher lists mods from these files, not from descriptor.mod alone, and it resolves
      // `path` relative to the game's user directory, so the standard form is `mod/<installedName>`.
      // The file holds every descriptor.mod key (name, version, supported_version, tags, picture,
      // replace_path, ...) plus `path`. Copy the descriptor text, drop any `path=` line the mod may
      // already declare, then append the new one, so no key is lost.
      //
      // This step is separate from the copy transaction, and its failure is reported as its own
      // failure. The files are already installed and the record is already updated at this point, so
      // a "copy failed" message here would be false.
      const installedName = basename(installDir);
      const pointerPath = join(modRoot, `${installedName}.mod`);
      let pointerWarning: string | null = null;
      try {
        const descriptorLines = readFileSync(join(modDir, "descriptor.mod"), "utf8")
          .split(/\r?\n/)
          .filter((line) => !/^\s*path\s*=/.test(line));
        // The launcher wants `supported_version` in the pointer file. The descriptor may omit it, so
        // take it from the recorded game build when it is missing. The conversion lives in
        // lib/game-paths, next to the build reader, so the two tools cannot drift apart.
        const hasSupported = descriptorLines.some((line) => /^\s*supported_version\s*=/.test(line));
        if (!hasSupported) {
          const derived = supportedGameVersion(readState(ctx.cwd).gameBuild as string | undefined);
          if (derived) descriptorLines.push(`supported_version="${derived}"`);
        }
        const body = descriptorLines.join("\n").replace(/\s*$/, "");
        const pointerText = `${body}\npath="mod/${installedName}"\n`;
        // Atomic: write a temporary file beside the target, then rename it over the target.
        const tmpPointer = `${pointerPath}.tmp-${process.pid}`;
        writeFileSync(tmpPointer, pointerText);
        renameSync(tmpPointer, pointerPath);
      } catch (error) {
        pointerWarning = `the mod files are installed at ${installDir} and the workspace record was updated, but the launcher pointer file ${pointerPath} could not be written (${error instanceof Error ? error.message : String(error)}), so the Paradox launcher will not list the mod`;
      }


      const mismatched = identity.name !== modName;
      const notes: string[] = [];
      if (asciiWarning) {
        notes.push(
          `\nWARN: ${asciiWarning}. The install went ahead, and the launcher will list the mod, but the game may load it with no files.\n` +
            `NEXT: tell the player this exactly. If the mod shows up but does nothing in the game, this path is the cause, and the fix is to move the mod install directory to an ASCII path, then run try_set_game_dir and install_mod again. ${targetVerdict.warningNext ?? ""}`,
        );
      }
      if (targetWasMissing) {
        notes.push(
          `\nNOTE: the mod install directory ${modRoot} did not exist and was created. That is normal on a first install, because the Paradox launcher had not created it yet. If the player expected mods somewhere else, for example after moving their Documents directory, tell them where this mod actually landed: ${installDir}.`,
        );
      }
      if (mismatched) {
        notes.push(
          `\nNOTE: the installed directory is named ${modName}, which is the your_mods directory name, while the mod declares name ${identity.name}. That difference is fine, because the launcher matches mods by the declared name and not by the directory name.`,
        );
      }
      if (duplicateDir) {
        notes.push(
          `\nNOTE: the same mod (name ${identity.name}) is also installed as ${duplicateDir}. This tool did not touch that copy. Tell the player which one to enable, and delete the other manually if it is stale.`,
        );
      }
      const extraNotes = notes.join("");
      const note = renamed
        ? `\nNOTE: ${modName} was already in use, by ${occupiedBy ? `another mod (${occupiedBy})` : "content this tool did not install"}. ` +
          `The tool installed as ${basename(installDir)} instead. That directory was left untouched, and the mod's own files, including its descriptor.mod name, were not modified.` +
          `\nNEXT: tell the player it installs as ${basename(installDir)}, then let them enable it in the launcher.`
        : `\nNEXT: ask the player to enable the mod in the Paradox launcher (and restart the game if it was running).`;
      const noteWithExtras = `${extraNotes}${note}`;

      // The files are in place and the workspace record is updated, but the launcher cannot see the
      // mod. That is a partial install, and it gets its own result, not a copy failure.
      if (pointerWarning) {
        return {
          content: [
            {
              type: "text",
              text: `PARTIAL: ${identity.name}${identity.version ? ` ${identity.version}` : ""} - ${pointerWarning}.\nNEXT: the mod files and the workspace record are correct. Fix the pointer file problem, then run install_mod again; a re-install updates in place.`,
            },
          ],
          details: {
            ok: false,
            reason: "POINTER_WRITE_FAILED",
            modName: identity.name,
            targetDir: installDir,
            files,
            pointerPath,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `PASS: ${identity.name}${identity.version ? ` ${identity.version}` : ""} installed to ${installDir} (${files} files).${noteWithExtras}`,
          },
        ],
        details: {
          ok: true,
          modName: identity.name,
          targetDir: installDir,
          updated: reused,
          renamed,
          occupiedBy,
          files,
          targetCreated: targetWasMissing,
          modInstallDirCorrected: target.corrected,
          warnings: asciiWarning ? ["TARGET_NOT_ASCII"] : [],
        },
      };
    },
  });
}
