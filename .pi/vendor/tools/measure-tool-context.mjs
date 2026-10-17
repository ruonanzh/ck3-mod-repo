// Measures what the vendored pi-subagents copy adds to every request: the tool declarations the
// extension registers. Run it after any change to the copy, and record the number in
// .pi/vendor/README.md.
//
// Usage:
//   node .pi/vendor/tools/measure-tool-context.mjs --host <dir with @earendil-works/* and typebox>
//
// The host packages come from the Pi installation. This copy carries none of them. The script copies
// the package to a temporary directory, links the host packages next to it, loads the extension with a
// recording fake of the Pi API, and prints the sizes. It changes nothing in the repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PEERS = ["@earendil-works/pi-tui", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent"];
const HOST_PACKAGES = [...PEERS, "typebox"];

const hostIndex = process.argv.indexOf("--host");
if (hostIndex === -1 || !process.argv[hostIndex + 1]) {
  console.error("Usage: node .pi/vendor/tools/measure-tool-context.mjs --host <dir with @earendil-works/* and typebox>");
  process.exit(2);
}
const host = path.resolve(process.argv[hostIndex + 1]);
const vendor = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "pi-subagents");
if (!fs.existsSync(path.join(vendor, "index.js"))) {
  console.error(`${vendor} is not the vendored pi-subagents copy.`);
  process.exit(2);
}
for (const pkg of HOST_PACKAGES) {
  if (!fs.existsSync(path.join(host, pkg))) {
    console.error(`The host directory has no ${pkg}.`);
    process.exit(2);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-measure-"));
try {
  const copy = path.join(work, "pi-subagents");
  fs.cpSync(vendor, copy, { recursive: true });
  for (const pkg of HOST_PACKAGES) {
    const link = path.join(copy, "node_modules", pkg);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    const kind = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(path.join(host, pkg), link, kind);
  }

  const calls = [];
  const makeProxy = (name) => {
    const fn = (...args) => { calls.push({ m: name, args }); return undefined; };
    return new Proxy(fn, {
      get(target, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (prop === "name") return name;
        return makeProxy(name ? `${name}.${String(prop)}` : String(prop));
      },
      apply(target, thisArg, args) { calls.push({ m: name, args }); return undefined; },
    });
  };

  const mod = await import(pathToFileURL(path.join(copy, "index.js")).href);
  await mod.default(makeProxy(""));

  const tools = calls.filter((call) => call.m === "registerTool");
  const others = calls.filter((call) => call.m !== "registerTool");
  let total = 0;
  console.log(`tools registered: ${tools.length}`);
  for (const call of tools) {
    const tool = call.args[0] ?? {};
    const description = String(tool.description ?? "");
    const schema = JSON.stringify(tool.parameters ?? null);
    const snippet = String(tool.promptSnippet ?? "");
    const guidelines = Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines.join("\n") : "";
    const size = description.length + schema.length + snippet.length + guidelines.length;
    total += size;
    console.log(`  ${tool.name}: description ${description.length} + schema ${schema.length} + snippet ${snippet.length} + guidelines ${guidelines.length} = ${size}`);
  }
  console.log(`tool declaration characters per request: ${total}`);
  // The `others` keys are fake-API proxy paths, not a distinct-handler count: every property access
  // on the recording Proxy builds a longer path name, so `on` and `events.on` count separately and
  // `registerEntryRenderer.call` is the Proxy's name, not a real method. R20's "29 event handlers" is a
  // different count; this line is only a sanity check that nothing else registered a tool.
  const counts = {};
  for (const call of others) counts[call.m] = (counts[call.m] ?? 0) + 1;
  console.log(`other API calls (fake-API proxy paths, not a distinct-handler count): ${JSON.stringify(counts)}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
