import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, lstatSync, mkdirSync, copyFileSync, statSync, readdirSync, rmSync, unlinkSync, rmdirSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { MIRROR_DIRNAME, MIRROR_ROOT_DIRNAME, NO_WORKSHOP_MARKER, WORKSHOP_MIRROR_DIRNAME, checkGameDir, checkWorkshopDir, mirrorDirs, readModRepoConfig, readState } from "../lib/game-paths";

/**
 * sync_game_scripts - it mirrors the text and definition scripts into the workspace's mirror. The
 * mirror has two parts: `game-scripts/vanilla/` is a copy of the game directory, and
 * `game-scripts/workshop/` holds one directory per Workshop mod. That mirror is the modding context
 * you must load before you write a mod. PDXScript has no self-describing API, so without these
 * scripts you do not know which vanilla objects to override. You also cannot find a localization key.
 *
 * It copies text and definition suffixes only, from the KEEP_SUFFIXES allowlist. That list matches
 * the sync tool in cursor main. It never copies a binary, so textures, meshes, and audio stay out.
 * The source paths come from .gamer-agent.local.json, which try_set_game_dir writes (gameDir and
 * workshopDir).
 *
 * It is idempotent. Every run walks the source again. It copies only the new or changed files, by
 * size and mtime, and it deletes the stale files that the source no longer has. git ignores
 * game-scripts/.
 */

const KEEP_SUFFIXES = new Set([
  ".yml", ".yaml", ".json", ".txt", ".gui", ".asset", ".schematic", ".particle2",
  ".info", ".compound", ".editordata", ".animsm", ".shader", ".fxh", ".csv", ".xml",
  ".md", ".py", ".lines", ".shadernodes", ".shadergraph", ".aggregate", ".shortcuts",
  ".settings", ".guianimset", ".guistateset", ".font", ".ugraph", ".map", ".mtl",
  ".dep", ".profile", ".anchor",
]);
const EXCLUDE_DIR_NAMES = new Set([".git", ".idea", ".vs"]);

/** Whether a path is a symbolic link, or a junction. A missing path is false, and an error is false. */
function isLink(p: string): boolean {
  try {
    return lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;
  } catch {
    return false;
  }
}

// Generated caches and large data directories. Their suffixes are text, but the content is not a
// mod reference script: map meshes, sound banks, terrain caches, and engine binaries.
const EXCLUDE_REL_MARKERS = ["gfx/map/map_objects/generated", "sound/banks", "terrain_cache", "binaries"];

function shouldExclude(rel: string): boolean {
  const r = rel.toLowerCase();
  return EXCLUDE_REL_MARKERS.some((m) => r.includes(m));
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function walkFiles(root: string): Array<{ abs: string; rel: string }> {
  const out: Array<{ abs: string; rel: string }> = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (EXCLUDE_DIR_NAMES.has(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = toPosix(relative(root, abs));
      if (shouldExclude(rel)) continue;
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push({ abs, rel });
    }
  };
  walk(root);
  return out;
}

function fileDiffers(src: string, dst: string): boolean {
  try {
    const ss = statSync(src);
    const ds = statSync(dst);
    if (ss.size !== ds.size) return true;
    if (Math.abs(ss.mtimeMs - ds.mtimeMs) > 2000) return true;
    return false;
  } catch {
    return true;
  }
}

function removeEmptyDirsUnder(root: string): void {
  const walkUp = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      // lstatSync, not statSync: a symbolic link is not descended, and the target stays untouched.
      try {
        if (lstatSync(p).isDirectory()) walkUp(p);
      } catch {
        /* ignore */
      }
    }
    if (dir !== root) {
      try {
        if (readdirSync(dir).length === 0) rmdirSync(dir);
      } catch {
        /* ignore */
      }
    }
  };
  walkUp(root);
}

/** Mirrors the allowlist files under srcRoot into dstRoot. Returns { copied, staleRemoved }. */
function syncTree(srcRoot: string, dstRoot: string): { copied: number; staleRemoved: number } {
  const srcFiles = walkFiles(srcRoot);
  const srcRels = new Set<string>();
  let copied = 0;

  for (const { abs, rel } of srcFiles) {
    srcRels.add(rel);
    const dot = rel.lastIndexOf(".");
    if (dot < 0 || !KEEP_SUFFIXES.has(rel.slice(dot).toLowerCase())) continue;
    const dst = join(dstRoot, rel);
    if (!existsSync(dst) || fileDiffers(abs, dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(abs, dst);
      copied += 1;
    }
  }

  let staleRemoved = 0;
  if (existsSync(dstRoot)) {
    for (const { abs, rel } of walkFiles(dstRoot)) {
      if (!srcRels.has(rel)) {
        try {
          unlinkSync(abs);
          staleRemoved += 1;
        } catch {
          /* ignore */
        }
      }
    }
    removeEmptyDirsUnder(dstRoot);
  }
  return { copied, staleRemoved };
}

/**
 * The source is gone. Wipe this whole mirror, because the old reference content must not keep posing
 * as the current game content.
 */
function pruneTree(dstRoot: string): { copied: number; staleRemoved: number } {
  let removed = 0;
  if (existsSync(dstRoot)) {
    for (const { abs } of walkFiles(dstRoot)) {
      try {
        unlinkSync(abs);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
    removeEmptyDirsUnder(dstRoot);
  }
  return { copied: 0, staleRemoved: removed };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "sync_game_scripts",
    label: "Sync Game Scripts",
    description:
      "Copies the game and Workshop script files into game-scripts/, which is the modding context you need before you write a mod. It copies text and definition files only, and it never copies a binary. PDXScript has no self-describing API, so you cannot write correct PDXScript without these scripts. The vanilla objects, effects, triggers, and keys all live there. Requires try_set_game_dir to have recorded the game directory first.",
    promptSnippet: "Load the game scripts into game-scripts/ (modding context)",
    promptGuidelines: [
      "Run sync_game_scripts before you write a mod, so the scripts are in game-scripts/. You cannot write correct PDXScript without those scripts.",
      "Run try_set_game_dir with no arguments first. When the game directory is unknown, sync_game_scripts fails, and its NEXT line points at try_set_game_dir.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const repoRoot = ctx.cwd;
      const dirs = mirrorDirs(repoRoot);
      // The state read and the "is the game directory usable" check both go through the lib, which
      // check_game_paths, try_set_game_dir, and install_mod share. This file used to parse the JSON
      // itself and call existsSync alone, which implemented the same check a second time.
      const state = readState(repoRoot);
      const gameVerdict = checkGameDir(typeof state.gameDir === "string" ? state.gameDir : null);
      if (!gameVerdict.ok) {
        return {
          content: [
            {
              type: "text",
              text: `FAIL: ${gameVerdict.reason}.\nNEXT: run try_set_game_dir with no arguments to locate the CK3 install, then run sync_game_scripts again.`,
            },
          ],
          details: { ok: false, errors: [gameVerdict.code ?? "GAME_DIRECTORY_NOT_FOUND"] },
        };
      }
      const gameDir = gameVerdict.path as string;
      const workshopDir = typeof state.workshopDir === "string" ? state.workshopDir : null;
      let steamAppId = "";
      try {
        steamAppId = String(readModRepoConfig(repoRoot).game?.steamAppId ?? "");
      } catch {
        /* The config is unreadable. The workshop shape check below therefore fails, so treat it as a rejection. */
      }

      const destRoot = dirs.root;
      // A link at any part of the modding context can point at the game directory. Writing through it would
      // copy files into the game, and the sweep below could then delete the game's own scripts. Stop
      // before any write or delete.
      const linked = [dirs.root, dirs.vanilla, dirs.vanillaScripts, dirs.workshop].filter(isLink);
      if (linked.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `FAIL: ${linked.map((p) => toPosix(relative(repoRoot, p)) + "/").join(", ")} is a symbolic link. The modding context must be a real directory, because a link can point at the game directory and this tool would write into the game or delete the game's scripts.\nNEXT: delete the link, or replace it with a directory, then run sync_game_scripts again.`,
            },
          ],
          details: { ok: false, errors: ["MIRROR_IS_SYMLINK"] },
        };
      }
      const g = syncTree(gameDir, dirs.vanilla);
      // The harness denies the Workshop content to the agent under test, so that it cannot read the
      // mods of another player. An earlier mirror is cleared too, because a copy on disk stays
      // readable. The harness creates the marker file with a shell command, and the agent under test
      // has no reason to look for it. A tool parameter would show this switch in the tool schema,
      // which the agent reads, so there is none.
      const skipWorkshop = existsSync(join(destRoot, NO_WORKSHOP_MARKER));
      const workshopMirror = dirs.workshop;
      let clearedForSkip = 0;
      let w = { copied: 0, staleRemoved: 0 };
      let workshopGone = false;
      let wsRejected = false;
      let wsRejectReason = "";
      if (skipWorkshop) {
        clearedForSkip = pruneTree(workshopMirror).staleRemoved;
      } else {
        // The Workshop source can disappear, when the player unsubscribes or deletes the directory.
        // The tool must not silently keep the old mirror, because the agent would keep reading it as
        // the current game content. Distinguish that from an unknown path:
        //   - The path is known and no longer exists: the source is gone. Clear it and say so.
        //   - The path is unknown (try_set_game_dir never ran): leave it alone, because it
        //     may be a valid mirror from an earlier run.
        const wsVerdict = checkWorkshopDir(workshopDir, steamAppId);
        workshopGone = typeof workshopDir === "string" && !existsSync(workshopDir);
        wsRejected = !wsVerdict.ok;
        wsRejectReason = wsVerdict.reason;
        w = wsVerdict.ok
          ? syncTree(wsVerdict.path as string, workshopMirror)
          : workshopGone
            ? pruneTree(workshopMirror)
            : { copied: 0, staleRemoved: 0 };
      }

      // The layout changed. Write the new copy first (above), then delete the old roots, so a
      // failed run leaves a readable mirror behind. A symbolic link is never deleted: it can point at
      // the game directory, and that is not this tool's copy. A failed delete does not stop the run.
      const stale = [{ path: dirs.legacy }, { path: dirs.legacyDump }];
      let legacyRemoved = 0;
      const staleNotes: string[] = [];
      for (const entry of stale) {
        let stat;
        try {
          stat = lstatSync(entry.path, { throwIfNoEntry: false });
        } catch (e) {
          staleNotes.push(
            `NOTE: could not inspect the old ${toPosix(relative(repoRoot, entry.path))}/ directory (${String(e)}). It was left in place.`,
          );
          continue;
        }
        if (!stat) continue;
        const rel = toPosix(relative(repoRoot, entry.path));
        if (stat.isSymbolicLink()) {
          staleNotes.push(
            `NOTE: ${rel}/ is a symbolic link, so it was not deleted. Delete it yourself when you are sure it does not point at the game directory.`,
          );
          continue;
        }
        const count = walkFiles(entry.path).length;
        try {
          rmSync(entry.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          legacyRemoved += count;
          staleNotes.push(
            `deleted the old ${rel}/ directory (${count} file(s)).${entry.path === dirs.legacy ? ` The vanilla scripts are now under ${MIRROR_ROOT_DIRNAME}/${MIRROR_DIRNAME}/.` : ` The dumps live in docs/script_docs/.`}`,
          );
        } catch (e) {
          staleNotes.push(
            `NOTE: could not delete the old ${rel}/ directory (${String(e)}). Run sync_game_scripts again to finish the cleanup.`,
          );
        }
      }

      // The `mirrored N` count above is what this run copied, so an up-to-date mirror reports 0.
      // That reads as "nothing is there", which is wrong: it keeps every file the earlier runs
      // copied. Count the context itself, after the sync, and report that total as well.
      const mirrorTotal = walkFiles(destRoot).length;

      const lines = [
        `PASS: mirrored ${g.copied + w.copied} script file(s) into ${toPosix(relative(repoRoot, destRoot))}/ (vanilla: ${g.copied}, workshop: ${w.copied})`,
        `mirror now holds ${mirrorTotal} file(s).`,
      ];
      if (g.staleRemoved + w.staleRemoved > 0) {
        lines.push(`deleted ${g.staleRemoved + w.staleRemoved} stale file(s) that the source no longer has.`);
      }
      lines.push(...staleNotes);
      if (workshopDir && wsRejected && !workshopGone) {
        lines.push(
          `NOTE: the workshop directory was rejected (${wsRejectReason}). The existing mirror under ${MIRROR_ROOT_DIRNAME}/${WORKSHOP_MIRROR_DIRNAME}/ was left untouched.`,
        );
      }
      if (workshopGone) {
        lines.push(
          `NOTE: the workshop source is gone (unsubscribed or deleted). Its mirrored copy under ${MIRROR_ROOT_DIRNAME}/${WORKSHOP_MIRROR_DIRNAME}/ was cleared (${w.staleRemoved} file(s)) instead of being left behind.`,
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { ok: true, copied: g.copied + w.copied, staleRemoved: g.staleRemoved + w.staleRemoved, legacyRemoved, workshopSourceMissing: workshopGone, workshopSkipped: skipWorkshop, workshopCleared: clearedForSkip },
      };
    },
  });
}
