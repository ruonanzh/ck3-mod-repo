/**
 * set_game_dir - the agent entry point. It records one concrete game directory, from the player or
 * from your own search.
 *
 * The split from try_set_game_dir: use this tool when you already have a path and must record it.
 * Use try_set_game_dir (no arguments) when you have no path and want the tool to ensure the game
 * directory is ready.
 *
 *   1. The path you give passes the check: the tool records it (PASS).
 *   2. It fails: the tool locates the game. When it finds one, it records that path (WARN), and it
 *      says why it did not use yours.
 *   3. Both fail: FAIL, and the tool records nothing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatPathOutcome, readModRepoConfig, resolveUserPath, setPathWithFallback } from "../lib/game-paths";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "set_game_dir",
    label: "Set Game Directory",
    description:
      "Record one concrete game directory for Crusader Kings III. The tool checks the path, and `binaries/ck3.exe` must exist. If the path fails the check, the tool locates the game and records that path instead, and returns WARN. Use try_set_game_dir when you have no path, and you want the tool to locate the paths.",
    promptSnippet: "Record one specific game directory (it checks the path, or locates the game)",
    promptGuidelines: [
      "Use set_game_dir when you have one concrete game directory to record, from the player or from your own search. It checks the path, then records it.",
      "If it returns WARN, your path failed the check, and the tool recorded a different path. Tell the player which path is in use.",
      "If it returns FAIL, the tool recorded nothing. Your path failed the check, and the search found no other path.",
      "Use try_set_game_dir instead when you have no path. It locates the game and records the derived paths.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Game directory to record. Relative paths use the workspace root." }),
    }),
    async execute(_id, params, _s, _u, ctx) {
      const cwd = ctx.cwd;
      let cfg;
      try {
        cfg = readModRepoConfig(cwd);
      } catch {
        throw new Error(
          "INVALID_WORKSPACE_CONFIG: Cannot read mod-repo.json. Reopen or update the game workspace. Do not edit its maintainer configuration.",
        );
      }
      const out = setPathWithFallback(cwd, cfg, "gameDir", resolveUserPath(cwd, params.path));
      const { text, ok, status } = formatPathOutcome(out);
      return { content: [{ type: "text", text }], details: { ok, status, kind: out.kind, given: out.given, recorded: out.recorded, wroteState: status !== "FAIL" } };
    },
  });
}
