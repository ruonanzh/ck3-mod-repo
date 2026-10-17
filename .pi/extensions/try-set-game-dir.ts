/**
 * try_set_game_dir - it ensures the game directory is ready. No arguments, and idempotent.
 *
 * The check and the search live in `.pi/lib/game-paths.ts`. This tool is only the entry point.
 *
 *   1. The remembered gameDir is still valid, and the derived mod install directory and Workshop
 *      directory match the recorded ones. The tool records no path, and it returns
 *      `PASS: gameDir already correct`. It returns the cached gameBuild. It reads the executable
 *      again only when no tag is cached (`null`) and no read has happened yet for this gameDir, and
 *      it writes that tag back with the `gameBuildTried` sentinel then.
 *   2. The path is invalid, stale, or never recorded. The tool locates the game, checks every
 *      candidate, reads the build tag one time, and records gameDir, gameBuild, and the two derived
 *      paths. It returns `PASS: gameDir located and recorded`.
 *   3. It finds nothing. The tool returns FAIL, and it writes no state.
 *
 * Why no arguments: the agent does not have to know the path first. The tool ensures the state is
 * ready by itself. Only after the tool fails does the agent look for clues or ask the player.
 *
 * CK3 facts: pure PDXScript, Windows only, and no runtime. modInstallDir is the Paradox launcher
 * directory, which is independent of gameDir. The tool derives workshopDir from gameDir, and the
 * tools treat workshopDir as a read-only reference.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureGameDir, readModRepoConfig, readState } from "../lib/game-paths";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "try_set_game_dir",
    label: "Ensure Game Directory",
    description:
      "Makes sure the game directory, the mod install directory, and the Steam Workshop directory are recorded and still valid. It takes no arguments. It either checks that the recorded paths are correct, or it locates the game and records the paths.",
    promptSnippet: "Ensure the game directory is recorded (locates it when needed)",
    promptGuidelines: [
      "Use try_set_game_dir when a task needs the game location, for example to install a mod or to sync the game scripts. Use it also when you are not sure that the paths are recorded and still valid.",
      "It takes no arguments. It checks the recorded paths, or it locates and records them, so you do not have to find the path yourself.",
      "It only records paths in .gamer-agent.local.json. It never creates and never changes anything inside the game.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _u, ctx) {
      const cwd = ctx.cwd;
      let cfg;
      try {
        cfg = readModRepoConfig(cwd);
      } catch {
        throw new Error(
          "INVALID_WORKSPACE_CONFIG: Cannot read mod-repo.json. Reopen or update the game workspace. Do not edit its maintainer configuration.",
        );
      }
      const r = await ensureGameDir(cwd, cfg);
      if (r.status === "missing") {
        return {
          content: [
            {
              type: "text",
              text: `FAIL: gameDir not found - ${r.reason}.\nNEXT: see the 'setup-workspace' skill.`,
            },
          ],
          details: {
            ...readState(cwd),
            ok: false,
            reason: "GAME_DIRECTORY_NOT_FOUND",
            wroteState: false,
          },
        };
      }
      const lines = [
        `PASS: gameDir ${r.status === "already" ? "already correct" : "located and recorded"} (${r.gameDir})`,
        r.modInstallDir
          ? `modInstallDir (the mod install directory) ${r.modInstallDir}`
          : "modInstallDir (none - mod-repo.json declares no mod install path)",
        r.workshopDir
          ? `workshopDir (derived, read-only reference) ${r.workshopDir}`
          : "workshopDir (not found, optional)",
      ];
      for (const w of r.warnings) lines.push(`WARN: ${w}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ...readState(cwd),
          ok: true,
          status: r.status,
          wroteState: r.wroteState,
        },
      };
    },
  });
}
