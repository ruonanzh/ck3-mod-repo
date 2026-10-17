import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * check_runtime - it reports the runtime prerequisites only. CK3 is pure PDXScript, with no SDK, no
 * compilation, and no third-party runtime, so the result is always "no dependencies".
 *
 * Responsibility boundary (one tool does one thing):
 *   - check_runtime      reports the runtime prerequisites only (this tool). CK3 has none. It does
 *                        not locate the game, and it does not touch the three paths.
 *   - try_set_game_dir   ensures the game directory is ready. No arguments, and idempotent. It
 *                        locates the game and records it, together with the two derived paths.
 *   - set_game_dir       records one concrete game directory, from the player or from you.
 *   - check_game_paths   checks the given or remembered paths only. Read-only, no scan, no write.
 *   - install_runtime    reports "no dependencies, nothing to install". It performs no install.
 *   - sync_game_scripts  mirrors the game/ and workshop/ scripts into game-scripts/, which is the
 *                        modding context you load before you write a mod.
 *   - install_mod        installs a mod, and creates the target directory when it is missing.
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "check_runtime",
    label: "Check Runtime",
    description:
      "Reports the runtime prerequisites for this workspace. CK3 is pure PDXScript, so there are none: no SDK, no compilation, and no runtime to install. This tool never installs anything, and it does not locate the game. The game and mod paths belong to check_game_paths, which checks them, and to try_set_game_dir or set_game_dir, which ensure or record them.",
    promptSnippet: "Check runtime prerequisites (CK3: none)",
    promptGuidelines: [
      "Use check_runtime when a task needs runtime or compile prerequisites, or when the player asks whether the environment is ready. CK3 has none, so it always passes.",
      "check_runtime does not locate the game, and it does not touch a path. A missing game directory is not a runtime problem. Ensure or record the paths with try_set_game_dir or set_game_dir, and check them with check_game_paths.",
      "check_runtime never installs anything, and it never writes state. CK3 has nothing to install.",
    ],
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [
          {
            type: "text",
            text: "PASS: no runtime dependencies for CK3 (pure PDXScript). There is no SDK, no compile step, and nothing to install. The player must install the game itself.\nNEXT: run try_set_game_dir with no arguments to record the game directory, the mod install directory, and the Workshop directory.",
          },
        ],
        details: { ok: true },
      };
    },
  });
}
