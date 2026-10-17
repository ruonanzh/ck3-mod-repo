/**
 * check_game_paths - check only. It checks the game directory, the Workshop directory, and the mod
 * install directory. Read-only, idempotent, no scan, and no write.
 *
 * The split from the other tools (do not mix them up):
 *   - check_game_paths   checks the given or remembered paths. This tool. It has no side effects,
 *                        so a read-only helper session can use it.
 *   - try_set_game_dir   ensures the game directory is ready. No arguments, and idempotent. It
 *                        locates the game and records it, together with the two derived paths.
 *   - set_game_dir       records one concrete game directory, from the player or from you.
 *   - install_mod        installs a mod, and creates the target directory when it is missing. It
 *                        shares the same check functions.
 *
 * The unattended search and the derivation are internal. They are not registered as a tool. See
 * setPathWithFallback in the lib.
 *
 * Note: the mod install directory is in the Paradox launcher directory. The path is
 * `<the player's Documents directory>/Paradox Interactive/Crusader Kings III/mod`, which is
 * independent of the game location. The player can move the Documents directory, so the lib reads
 * it from Windows. Its check is therefore a shape check, and not a sibling-directory sentinel.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  checkGameDir,
  checkModInstallDir,
  checkWorkshopDir,
  effectiveModInstallDir,
  readModRepoConfig,
  readState,
  resolveUserPath,
  statePath,
  workshopSupported,
  type ModRepoConfig,
  type PathVerdict,
} from "../lib/game-paths";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "check_game_paths",
    label: "Check Game Paths",
    description:
      "Check three directories: the game directory, the Steam Workshop directory, and the mod install directory. This tool is read-only. It never writes .gamer-agent.local.json, never scans Steam, and never creates a directory. Pass any of gameDir, workshopDir, or modInstallDir to check those paths. Omit all three to check the paths in .gamer-agent.local.json. Use it when the player gives you a path, or to check a remembered path. Use try_set_game_dir when the location is unknown.",
    promptSnippet: "Check game and mod paths without scanning or writing",
    promptGuidelines: [
      "Use check_game_paths when the player gives you a path, or to check a remembered path. It checks a path without scanning Steam and without writing state.",
      "check_game_paths never writes .gamer-agent.local.json. Checking and recording are separate tools.",
      "A failed check_game_paths changes nothing, because the tool is read-only. Follow its NEXT line to fix the problem. It never creates and never installs anything.",
    ],
    parameters: Type.Object({
      gameDir: Type.Optional(Type.String({ description: "Game directory to check. Relative paths use the workspace root." })),
      workshopDir: Type.Optional(Type.String({ description: "Steam Workshop directory to check (optional)." })),
      modInstallDir: Type.Optional(Type.String({ description: "Mod install directory to check (optional)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const cfg: ModRepoConfig = readModRepoConfig(cwd);
      const state = readState(cwd);
      const appId = String(cfg.game?.steamAppId ?? "");

      const explicit = [params.gameDir, params.workshopDir, params.modInstallDir].some(
        (v) => typeof v === "string" && v.trim() !== "",
      );
      const remembered = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
      const asPath = (v: string | undefined): string | null => (v?.trim() ? resolveUserPath(cwd, v) : null);

      // The contract: check what you pass. With no arguments, check the paths recorded in
      // .gamer-agent.local.json.
      //
      // Which paths are required, and whether the Workshop matters, comes from mod-repo.json:
      //   - The contract declares modInstall as non-null: modInstallDir is required. A type with
      //     modInstall: null does not require it.
      //   - workshop.supported === false: the tool ignores workshopDir completely. It does not
      //     check it, does not report it, and does not use it in the verdict.
      //   - workshopDir never produces ERROR, right or wrong. It is a read-only reference, so at
      //     most it produces WARN.
      const requiresModInstall = cfg.modInstall !== null && cfg.modInstall !== undefined;
      const workshop = workshopSupported(cfg); // true | false | null (undeclared means unknown)
      const requiredKeys: string[] = ["gameDir", ...(requiresModInstall ? ["modInstallDir"] : [])];

      const allTargets: Array<[string, string | null]> = explicit
        ? [
            ["gameDir", asPath(params.gameDir)],
            ["workshopDir", asPath(params.workshopDir)],
            ["modInstallDir", asPath(params.modInstallDir)],
          ]
        : [
            ["gameDir", remembered(state.gameDir)],
            ["workshopDir", remembered(state.workshopDir)],
            ["modInstallDir", remembered(state.modInstallDir)],
          ];
      const workshopIgnored =
        workshop === false && allTargets.some(([key, path]) => key === "workshopDir" && path !== null);
      const targets = allTargets.filter(([key]) => !(key === "workshopDir" && workshop === false));

      if (targets.every(([, path]) => path === null)) {
        // Nothing to do only because this game has no Workshop. Say that clearly, and do not
        // report a missing path, which misleads.
        if (workshopIgnored && requiredKeys.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "PASS: nothing to check - this game type declares no Steam Workshop (mod-repo.json: workshop.supported = false), so workshopDir was ignored.\nNEXT: pass gameDir or modInstallDir to check them.",
              },
            ],
            details: { ok: true, checked: {}, failed: [], warnings: [], ignored: ["workshopDir"], wroteState: false },
          };
        }
        if (explicit || requiredKeys.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `FAIL: nothing to check - no paths were given and none are recorded in ${statePath(cwd)}.\nNEXT: run try_set_game_dir with no arguments to locate the game, or pass gameDir explicitly. See the 'setup-workspace' skill if the search fails.`,
              },
            ],
            details: { ok: false, reason: "NOTHING_TO_CHECK" },
          };
        }
      }

      const verdicts: Record<string, PathVerdict> = {};
      for (const [key, path] of targets) {
        if (path === null) continue;
        if (key === "gameDir") verdicts[key] = checkGameDir(path);
        else if (key === "workshopDir") verdicts[key] = checkWorkshopDir(path, appId);
        else verdicts[key] = checkModInstallDir(path, cfg);
      }

      // A recorded mod install directory can contradict mod-repo.json. That happens when the player
      // moves the Documents directory after the tool recorded the path, and the record then names a
      // directory that the launcher does not read. The check below is a shape check, so the stale
      // path passes it. The tool therefore compares the record with the derived path and reports
      // the difference. install_mod and get_game_info use the derived path. This tool is read-only,
      // so it reports the difference and does not repair the record.
      // The comparison runs only on the remembered route: the explicit route checks what you pass.
      const record = explicit ? null : effectiveModInstallDir(cwd, cfg);

      const lines: string[] = [];
      const failed: string[] = [];
      const warnings: string[] = [];
      for (const [key, v] of Object.entries(verdicts)) {
        if (v.ok) {
          if (key === "modInstallDir" && record?.corrected && record.derived) {
            lines.push(`WARN: modInstallDir ${v.path} - this is not the path that mod-repo.json gives.`);
            lines.push(`  mod-repo.json gives: ${record.derived}`);
            lines.push("  NEXT: run try_set_game_dir with no arguments. It records the path that mod-repo.json gives.");
            warnings.push(key);
            continue;
          }
          lines.push(`PASS: ${key} ${v.path} (correct)`);
          continue;
        }
        // workshopDir is extra information, and it never produces ERROR.
        if (key === "workshopDir") {
          lines.push(`WARN: workshopDir ${v.path ?? "(not given)"} - ${v.reason}`);
          if (v.next) lines.push(`  NEXT: ${v.next}`);
          warnings.push(key);
          continue;
        }
        lines.push(`FAIL: ${key} ${v.path ?? "(not given)"} - ${v.reason}`);
        if (v.next) lines.push(`  NEXT: ${v.next}`);
        failed.push(key);
      }

      // A required path is missing. Report it only on the remembered-paths route. With explicit
      // arguments, the tool checks what you pass.
      if (!explicit) {
        for (const key of requiredKeys) {
          if (verdicts[key] || failed.includes(key)) continue;
          lines.push(`FAIL: ${key} (not recorded) - this path is required for this game type.`);
          lines.push(
            key === "gameDir"
              ? "  NEXT: run try_set_game_dir with no arguments to locate the game and record it. See the 'setup-workspace' skill for the search steps if it fails."
              : "  NEXT: run try_set_game_dir (no arguments) - the mod install target is derived from the game directory.",
          );
          failed.push(key);
        }
        // The contract declares a Workshop, and workshopDir is not recorded yet. Report WARN, and
        // only when every required path passed.
        if (workshop === true && failed.length === 0 && !remembered(state.workshopDir)) {
          lines.push(
            "WARN: workshopDir (not recorded) - this game has a Workshop. Recording it lets you read existing Workshop content for reference.",
          );
          lines.push("  NEXT: run try_set_game_dir (no arguments) - the Workshop directory is derived together with the game directory.");
          warnings.push("workshopDir");
        }
      }

      const ok = failed.length === 0;
      if (!ok) {
        lines.push(
          `NOTE: the tool changed nothing, because it is read-only. State lives only in this workspace's ${statePath(cwd)}. To record the paths, run try_set_game_dir with no arguments, and ask the player only if the search fails.`,
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { ok, checked: verdicts, failed, warnings, wroteState: false },
      };
    },
  });
}
