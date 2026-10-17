import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * install_runtime - the runtime contract.
 *
 * A CK3 mod is pure PDXScript. There is no compilation, no SDK, and no runtime to install, so
 * install_runtime always succeeds. The player must install the game itself. try_set_game_dir
 * locates the game directory and records it.
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "install_runtime",
    label: "Install Runtime",
    description:
      "A CK3 mod is pure PDXScript, with no runtime and no SDK to install. This tool reports that CK3 needs no runtime, and it installs nothing. It also tells the agent that the player must install the game itself. Use try_set_game_dir to record the game directory and the two derived directories.",
    promptSnippet: "Install runtime (CK3: nothing to install)",
    promptGuidelines: [
      "Use install_runtime only when you think a runtime is missing. For CK3 it always reports SKIP: no dependencies, and nothing installed.",
      "A missing game directory is not a runtime problem. Record it with try_set_game_dir and no arguments, and not with install_runtime.",
    ],
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [
          {
            type: "text",
            text: "SKIP: no runtime dependencies, and no installation was performed. The player must install the game itself.\nNEXT: run try_set_game_dir to record the game directory, the mod install directory, and the Workshop directory. Run sync_game_scripts before you write a mod.",
          },
        ],
        details: { ok: true },
      };
    },
  });
}
