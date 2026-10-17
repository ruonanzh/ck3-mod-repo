import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { checkGameDir, checkWorkshopDir, readModRepoConfig, readState } from "../lib/game-paths";

/**
 * sync_game_scripts - it mirrors the text and definition scripts from game/ and workshop/ into the
 * workspace's game-scripts/. That directory is the modding context you must load before you write a
 * mod. PDXScript has no self-describing API, so without these scripts you do not know which vanilla
 * objects to override. You also cannot find a localization key.
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
      try {
        if (statSync(p).isDirectory()) walkUp(p);
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

const NO_WORKSHOP_MARKER = ".no-workshop";

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

      const destRoot = join(repoRoot, "game-scripts");
      const g = syncTree(gameDir, join(destRoot, "game"));
      // The harness denies the Workshop content to the agent under test, so that it cannot read the
      // mods of another player. An earlier mirror is cleared too, because a copy on disk stays
      // readable. The harness creates the marker file with a shell command, and the agent under test
      // has no reason to look for it. A tool parameter would show this switch in the tool schema,
      // which the agent reads, so there is none.
      const skipWorkshop = existsSync(join(destRoot, NO_WORKSHOP_MARKER));
      const workshopMirror = join(destRoot, "workshop");
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
        //   - The path is known and no longer exists: the source is gone. Clear the mirror and say so.
        //   - The path is unknown (try_set_game_dir never ran): leave the mirror alone, because it
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

      // The `mirrored N` count above is what this run copied, so an up-to-date mirror reports 0.
      // That reads as "the mirror is empty", which is wrong: the mirror keeps every file the earlier
      // runs copied. Count the mirror itself, after the sync, and report that total as well.
      const mirrorTotal = walkFiles(destRoot).length;

      const lines = [
        `PASS: mirrored ${g.copied + w.copied} script file(s) into ${toPosix(relative(repoRoot, destRoot))}/ (game: ${g.copied}, workshop: ${w.copied})`,
        `mirror now holds ${mirrorTotal} file(s).`,
      ];
      if (g.staleRemoved + w.staleRemoved > 0) {
        lines.push(`deleted ${g.staleRemoved + w.staleRemoved} stale file(s) that the source no longer has.`);
      }
      if (workshopDir && wsRejected && !workshopGone) {
        lines.push(
          `NOTE: the workshop directory was rejected (${wsRejectReason}). The existing mirror under game-scripts/workshop was left untouched.`,
        );
      }
      if (workshopGone) {
        lines.push(
          `NOTE: the workshop source is gone (unsubscribed or deleted). Its mirrored copy under game-scripts/workshop was cleared (${w.staleRemoved} file(s)) instead of being left behind.`,
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { ok: true, copied: g.copied + w.copied, staleRemoved: g.staleRemoved + w.staleRemoved, workshopSourceMissing: workshopGone, workshopSkipped: skipWorkshop, workshopCleared: clearedForSkip },
      };
    },
  });
}
