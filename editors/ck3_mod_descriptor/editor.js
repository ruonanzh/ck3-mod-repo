/**
 * Editor tool for a CK3 mod's `descriptor.mod` (key=value text, the copy inside the mod folder).
 *
 * Uses only the host postMessage bridge (`editor:init`, `editor:readFile`, `editor:save`, and
 * `editor:theme`): no network, no permissions beyond that. Validation mirrors this repo's `validate_mod`
 * (`.pi/extensions/mod-lint.ts`): errors block saving, warnings do not.
 */
const TEXT_FIELDS = ["name", "version", "supported_version", "picture"];
const SEMVER_RE = /^\d+\.\d+(\.\d+)?$/;

let writable = false;
let revision = null;
/** Parsed known fields; other keys (remote_file_id, replace_path, comments, …) are preserved on save. */
let model = {};
let otherLines = [];
let dirty = false;
let seq = 0;
const pending = new Map();

const $ = (id) => document.getElementById(id);
const post = (message) => window.parent.postMessage(message, "*");

function request(type, payload) {
  const requestId = `r${++seq}`;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    post({ type, requestId, ...payload });
  });
}

function settle(requestId, value) {
  const resolve = pending.get(requestId);
  if (resolve) {
    pending.delete(requestId);
    resolve(value);
  }
}

/** Parse one `key = <rest>` line. Returns null when the line is not a key=value assignment. */
function parseLine(line) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  return m ? { key: m[1], rest: m[2] } : null;
}

/** Parse a scalar value `"…"`. Returns the inner text, or "" when not a quoted scalar. */
function parseScalar(rest) {
  const m = /^"([^"]*)"$/.exec(rest.trim());
  return m ? m[1] : "";
}

/** Parse a list `{ "a" "b" }`. Returns the quoted items. */
function parseList(rest) {
  const t = rest.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return [];
  const items = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(t))) items.push(m[1]);
  return items;
}

function parseDescriptor(text) {
  const model = {};
  const otherLines = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      otherLines.push(raw);
      continue;
    }
    const p = parseLine(line);
    if (!p) {
      otherLines.push(raw);
      continue;
    }
    if (p.key === "tags") model.tags = parseList(p.rest);
    else if (TEXT_FIELDS.includes(p.key)) model[p.key] = parseScalar(p.rest);
    else otherLines.push(raw);
  }
  return { model, otherLines };
}

function serialize(model, otherLines) {
  const out = [];
  for (const field of TEXT_FIELDS) {
    const v = model[field];
    if (v != null && String(v) !== "") out.push(`${field}="${String(v)}"`);
  }
  if (Array.isArray(model.tags) && model.tags.length) {
    out.push(`tags={ ${model.tags.map((t) => `"${t}"`).join(" ")} }`);
  }
  out.push(...otherLines);
  return out.join("\n") + (out.length ? "\n" : "");
}

/** Mirror mod-lint: `name` non-empty; `version` semver x.x / x.x.x. */
function validate(value) {
  const errors = [];
  const warnings = [];
  if (!String(value.name || "").trim()) errors.push("name must be a non-empty string");
  if (typeof value.version === "string" && value.version !== "" && !SEMVER_RE.test(value.version)) {
    errors.push(`version '${value.version}' is not semver x.x or x.x.x`);
  }
  if (typeof value.version !== "string" || String(value.version).trim() === "") {
    errors.push("version is required");
  }
  if (!String(value.supported_version || "").trim()) warnings.push('missing "supported_version" (e.g. "1.20.*")');
  if (!value.picture) warnings.push('missing "picture" (e.g. "thumbnail.png")');
  return { errors, warnings };
}

function splitTags(raw) {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function readForm() {
  const next = { ...model };
  for (const field of TEXT_FIELDS) next[field] = $(`f-${field}`).value;
  next.tags = splitTags($("f-tags").value);
  return next;
}

function paint() {
  const value = readForm();
  const { errors, warnings } = validate(value);
  const status = $("status");
  status.textContent = errors.length ? "invalid — fix errors to save" : dirty ? "unsaved (Ctrl+S)" : "saved";
  status.dataset.state = errors.length ? "error" : dirty ? "dirty" : "clean";
  $("save").disabled = !writable || errors.length > 0;

  const list = $("issues");
  list.hidden = errors.length + warnings.length === 0;
  list.replaceChildren(
    ...errors.map((message) => Object.assign(document.createElement("li"), { className: "error", textContent: `error: ${message}` })),
    ...warnings.map((message) => Object.assign(document.createElement("li"), { className: "warn", textContent: `warn: ${message}` })),
  );
}

function setDirty(next) {
  dirty = next;
  paint();
}

function fill(value) {
  model = value && typeof value === "object" ? { ...value } : {};
  for (const field of TEXT_FIELDS) {
    const current = model[field];
    $(`f-${field}`).value = current == null ? "" : String(current);
  }
  $("f-tags").value = Array.isArray(model.tags) ? model.tags.map((tag) => String(tag)).join(", ") : "";
  dirty = false;
  paint();
}

async function load() {
  const response = await request("editor:readFile", {});
  if (response.code) {
    $("issues").hidden = false;
    $("issues").replaceChildren(
      Object.assign(document.createElement("li"), { className: "error", textContent: `error: ${response.message || "read failed"}` }),
    );
    return;
  }
  revision = response.revision ?? null;
  const { model: parsed, otherLines: kept } = parseDescriptor(response.data);
  model = parsed;
  otherLines = kept;
  fill(parsed);
}

async function save() {
  if (!writable) return;
  const next = readForm();
  if (validate(next).errors.length) {
    paint();
    return;
  }
  const response = await request("editor:save", {
    data: serialize(next, otherLines),
    baseRevision: revision ?? undefined,
  });
  if (response.code) {
    const list = $("issues");
    list.hidden = false;
    list.replaceChildren(
      Object.assign(document.createElement("li"), {
        className: "error",
        textContent:
          response.code === "CONFLICT"
            ? "error: the file changed on disk — press Reload first, otherwise you would overwrite someone else's edit"
            : `error: ${response.message || "save failed"}`,
      }),
    );
    return;
  }
  revision = response.revision ?? revision;
  model = next;
  setDirty(false);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

window.addEventListener("message", (event) => {
  const data = event.data || {};
  switch (data.type) {
    case "editor:init":
      writable = data.mode === "edit" && Boolean(data.writable);
      $("file").textContent = (data.file && data.file.name) || "descriptor.mod";
      applyTheme(data.theme);
      post({ type: "editor:ready" });
      void load();
      break;
    case "editor:fileContent":
    case "editor:saved":
    case "editor:error":
      settle(data.requestId, data);
      break;
    case "editor:theme":
      applyTheme(data.theme);
      break;
    default:
      break;
  }
});

for (const field of [...TEXT_FIELDS, "tags"]) $(`f-${field}`).addEventListener("input", () => setDirty(true));
$("reload").addEventListener("click", () => void load());
$("save").addEventListener("click", () => void save());
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
  }
});
