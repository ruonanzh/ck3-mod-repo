/**
 * CK3 mod 页面编辑器。
 *
 * 显示 agent 生成的 mod 页面（`*.modpage.html`），让玩家标批注：选中文字，然后批注、标删除或写替换。
 *
 * 只读写宿主打开的那一个文件。批注落在同一份 HTML 文件里、`<body>` 末尾的
 * `<script type="application/json" id="pi-page-feedback">` 块中，连同页面上带 `name` 的表单控件的值。
 * 玩家说「批注好了」时，agent 从那里读。
 *
 * 桥就是 EditorHost.tsx 那一套：`editor:init` 与 `editor:theme` 进来，`editor:readFile` 与
 * `editor:save` 出去。两条消息都带 `theme`（`dark` 或 `light`）与 `fontFamily`（宿主当前生效的
 * 界面字体栈），面板照它设 `body[data-theme]` 与 `--app-font`。
 */
const FEEDBACK_ID = "pi-page-feedback";
const SCRIPT_RE = new RegExp(`<script[^>]*id="${FEEDBACK_ID}"[^>]*>[\\s\\S]*?</script>\\s*`, "i");
const BLOCK_RE = new RegExp(`<script[^>]*id="${FEEDBACK_ID}"[^>]*>([\\s\\S]*?)</script>`, "i");

const state = document.getElementById("state");
const count = document.getElementById("count");
const saveButton = document.getElementById("save");
const removeButton = document.getElementById("remove");
const reloadButton = document.getElementById("reload");
const page = document.getElementById("page");
const scroll = document.getElementById("scroll");
const toolbar = document.getElementById("toolbar");
const promptForm = document.getElementById("prompt");
const promptLabel = document.getElementById("promptLabel");
const promptText = document.getElementById("promptText");

let revision = null;
let source = "";
let writable = false;
let comments = [];
let baseline = {};
let pending = null;
let pendingReload = null;
let savedSinceLoad = false;
let selectedId = null;
let lastRange = null;
let seq = 0;
const waiting = new Map();

function post(message) {
  window.parent.postMessage(message, "*");
}

function request(type, payload) {
  const requestId = `r${++seq}`;
  return new Promise((resolve) => {
    waiting.set(requestId, resolve);
    post({ type, requestId, ...payload });
  });
}

function settle(requestId, value) {
  const resolve = waiting.get(requestId);
  if (resolve) {
    waiting.delete(requestId);
    resolve(value);
  }
}

function say(text) {
  state.textContent = text;
}

/** 重新从磁盘读一次；旧的未发出批注作废（按约定：刷新就是弃旧）。 */
function reloadFromDisk(reason) {
  pendingReload = reason;
  post({ type: "editor:readFile", requestId: `r${++seq}` });
}

reloadButton.addEventListener("click", () => reloadFromDisk("manual"));

/* ---------- 读文件与写文件 ---------- */

function readBlock(content) {
  const match = content.match(BLOCK_RE);
  if (!match) return { comments: [], controls: {} };
  try {
    const parsed = JSON.parse(match[1]);
    return {
      comments: Array.isArray(parsed && parsed.comments) ? parsed.comments : [],
      controls:
        parsed && typeof parsed.controls === "object" && parsed.controls !== null ? parsed.controls : {},
    };
  } catch {
    return { comments: [], controls: {} };
  }
}

function withBlock(content, nextComments, controls) {
  const cleaned = content.replace(SCRIPT_RE, "");
  if (nextComments.length === 0 && Object.keys(controls).length === 0) return cleaned;
  const payload = JSON.stringify({ version: 1, comments: nextComments, controls }, null, 2);
  const block = `<script type="application/json" id="${FEEDBACK_ID}">\n${payload}\n</script>\n`;
  const bodyEnd = cleaned.toLowerCase().lastIndexOf("</body>");
  if (bodyEnd === -1) return `${cleaned.replace(/\s*$/, "\n")}${block}`;
  return `${cleaned.slice(0, bodyEnd)}${block}${cleaned.slice(bodyEnd)}`;
}

/* ---------- 显示页面 ---------- */

function renderPage(content) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  doc.querySelector(`#${FEEDBACK_ID}`)?.remove();
  doc.querySelectorAll("script").forEach((element) => element.remove());

  page.replaceChildren();
  doc.head.querySelectorAll("style").forEach((element) => page.append(element.cloneNode(true)));
  Array.from(doc.body.childNodes).forEach((node) => page.append(node.cloneNode(true)));
}

/* ---------- 页面上的表单控件 ---------- */

/** 读页面上所有带 name 的控件，这样勾选框的状态也存得下来。 */
function readControls() {
  const values = {};
  page.querySelectorAll("input[name], select[name], textarea[name]").forEach((element) => {
    const name = element.getAttribute("name");
    if (!name) return;
    if (element.type === "checkbox" || element.type === "radio") {
      if (element.checked) values[name] = element.value || "on";
      else if (!(name in values)) values[name] = "";
      return;
    }
    values[name] = element.value;
  });
  return values;
}

function applyControls(values) {
  if (!values) return;
  page.querySelectorAll("input[name], select[name], textarea[name]").forEach((element) => {
    const name = element.getAttribute("name");
    if (!name || !(name in values)) return;
    const saved = values[name];
    if (element.type === "checkbox" || element.type === "radio") {
      element.checked = saved !== "" && saved === (element.value || "on");
      return;
    }
    element.value = saved;
  });
}

function sameControls(left, right) {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const name of names) if ((left[name] ?? "") !== (right[name] ?? "")) return false;
  return true;
}

/* ---------- 批注 ---------- */

/** 把 #page 里所有文本节点拼起来，用于按引文定位。 */
function textIndex() {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = "";
  let node = walker.nextNode();
  while (node) {
    nodes.push({ node, from: text.length });
    text += node.nodeValue;
    node = walker.nextNode();
  }
  return { nodes, text };
}

/** 引文的起始全局偏移；第 occurrence 次出现（从 0 数）。 */
function findQuoteStart(quote, occurrence) {
  const { text } = textIndex();
  let at = -1;
  let seen = 0;
  for (;;) {
    at = text.indexOf(quote, at + 1);
    if (at === -1) return null;
    if (seen === occurrence) return at;
    seen += 1;
  }
}

/** 表格的结构元素：在里面插 <mark> 会被浏览器当成新行或新列。 */
const TABLE_STRUCTURE = new Set(["TABLE", "TBODY", "THEAD", "TFOOT", "TR", "COLGROUP", "CAPTION"]);

/** 把一段全局区间拆成每个文本节点里的一段（跨节点选中也能高亮，且不动原标签）。 */
function segmentsFor(start, length) {
  const { nodes } = textIndex();
  const end = start + length;
  const out = [];
  for (const { node, from } of nodes) {
    const nodeEnd = from + node.nodeValue.length;
    if (nodeEnd <= start || from >= end) continue;
    const slice = node.nodeValue.slice(Math.max(0, start - from), Math.min(node.nodeValue.length, end - from));
    // 只含空白的段不包：跨行选中会碰上行与行之间的换行文本，包了会在表格里多一行。
    if (!slice.trim()) continue;
    // 表格结构元素（tbody、tr …）里不能插 mark，浏览器会拿它当行或列。
    if (TABLE_STRUCTURE.has(node.parentNode?.tagName)) continue;
    out.push({
      node,
      start: Math.max(0, start - from),
      end: Math.min(node.nodeValue.length, end - from),
    });
  }
  return out;
}

/** 给一条批注打高亮：逐段包 <mark>，每段都在单个文本节点里，所以不会撕开外层标签。 */
function wrapQuote(quote, comment, occurrence) {
  if (!quote) return false;
  const start = findQuoteStart(quote, occurrence ?? 0);
  if (start === null) return false;
  segmentsFor(start, quote.length).forEach(({ node, start: from, end: to }) => {
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const element = document.createElement("mark");
    element.dataset.comment = comment.id;
    element.dataset.kind = comment.kind;
    element.title = comment.text || comment.kind;
    range.surroundContents(element);
  });
  return true;
}

/** 整段文字的全局偏移（用于记录“第几次出现”）。 */
function globalOffset(node, offset) {
  const { nodes, text } = textIndex();
  for (const entry of nodes) {
    if (entry.node === node) return entry.from + offset;
  }
  return Math.min(offset, text.length);
}

function paintComments() {
  page.querySelectorAll("mark[data-comment]").forEach((element) => {
    const parent = element.parentNode;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
    parent.normalize();
  });
  comments.forEach((comment) => wrapQuote(comment.quote, comment, comment.occurrence ?? 0));
  updateBar();
}

function updateBar() {
  count.textContent = comments.length === 0 ? "" : `${comments.length} 条批注`;
  // 只在文件不能写时才置灰：没内容时也要能点，点了才说得清为什么没东西可发。
  saveButton.disabled = !writable;
  removeButton.hidden = selectedId === null;
}

const SEND_ERROR_TEXT = {
  AGENT_BUSY: "已写入页面。agent 正在运行，稍等一下再点『发送给 Agent』。",
  NO_SESSION: "已写入页面。这个面板没挂到会话上：到对话里发送 /page-annotated。",
  NOT_ALLOWED: "已写入页面。这个文件在 mod 之外，不能替你发消息：到对话里发送 /page-annotated。",
  SEND_FAILED: "已写入页面。消息没发出去：到对话里发送 /page-annotated。",
};

const SAVE_ERROR_TEXT = {
  READ_ONLY: "这个文件在 mod 之外，不能写入。",
  WRITE_DENIED: "只能写 your_mods/ 里的文件。",
  CONFLICT: "页面已被改动（可能是 agent 刚重写过）。关掉再打开这一页，重新标。",
  TOO_LARGE: "页面文件太大，写不下。",
};

/** 这次选中的是引文在正文里的第几次出现（同样文字在不同行时，高亮不会跑到别的行）。 */
function occurrenceFor(range) {
  const quote = range.toString();
  if (!quote) return 0;
  if (typeof range.startContainer.nodeValue !== "string") return 0;
  const start = globalOffset(range.startContainer, range.startOffset);
  const { text } = textIndex();
  let seen = 0;
  let at = text.indexOf(quote);
  while (at !== -1 && at < start) {
    seen += 1;
    at = text.indexOf(quote, at + 1);
  }
  return seen;
}

function addComment(kind, quote, text, occurrence) {
  comments.push({
    id: `c${Date.now().toString(36)}${comments.length}`,
    kind,
    quote,
    text: text || "",
    ...(occurrence ? { occurrence } : {}),
  });
  paintComments();
  say("已添加。最后点『发送给 Agent』。");
}

function closePrompt() {
  pending = null;
  lastRange = null;
  promptForm.hidden = true;
}

document.getElementById("promptCancel").addEventListener("click", closePrompt);

// 点弹框以外的地方就收起它（点弹框内部的按钮不算）。
document.addEventListener("mousedown", (event) => {
  if (promptForm.hidden) return;
  if (promptForm.contains(event.target)) return;
  closePrompt();
});

// 焦点离开弹框也收起（按 Tab 走开、点空白处等）。
promptForm.addEventListener("focusout", (event) => {
  if (promptForm.contains(event.relatedTarget)) return;
  if (document.activeElement && promptForm.contains(document.activeElement)) return;
  closePrompt();
});

function commitPrompt() {
  if (!pending) return;
  addComment(pending.kind, pending.quote, promptText.value.trim(), pending.occurrence);
  closePrompt();
  window.getSelection()?.removeAllRanges();
}

// 故意不用 <form>：编辑器 iframe 的 sandbox 是 allow-scripts，没有 allow-forms，
// 浏览器会直接拦下表单提交（"Blocked form submission … sandboxed"），处理函数根本不会跑。
document.getElementById("promptAdd").addEventListener("click", commitPrompt);

promptText.addEventListener("keydown", (event) => {
  if (event.key === "Enter") commitPrompt();
  if (event.key === "Escape") closePrompt();
});

/* ---------- 选词与工具栏 ---------- */

function hideToolbar() {
  toolbar.hidden = true;
}

function currentRange() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (!range.collapsed && page.contains(range.commonAncestorContainer)) {
      lastRange = range.cloneRange();
      return range;
    }
  }
  return null;
}

function showToolbar() {
  const range = currentRange();
  if (!range) {
    hideToolbar();
    return;
  }
  // 坐标相对滚动容器（也是 #toolbar 的包含块），所以工具栏贴在选区上，并随内容滚动。
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  const frame = typeof scroll.getBoundingClientRect === "function" ? scroll.getBoundingClientRect() : null;
  toolbar.hidden = false;
  if (!box || !frame) return; // 宿主给不出几何信息时，只显示、不定位
  const width = toolbar.offsetWidth || 200;
  const left = box.left - frame.left + scroll.scrollLeft;
  const top = box.bottom - frame.top + scroll.scrollTop + 6;
  toolbar.style.left = `${Math.max(8, Math.min(left, scroll.clientWidth - width - 8))}px`;
  toolbar.style.top = `${Math.max(8, top)}px`;
}

function askForText(kind) {
  // 点按钮会先清掉选区，所以这里用选词时记下的那个 range。
  if (!lastRange) return;
  pending = { kind, quote: lastRange.toString(), occurrence: occurrenceFor(lastRange) };
  if (!pending.quote) return;
  promptLabel.textContent = kind === "replace" ? "替换为" : "批注内容";
  promptText.value = "";
  promptForm.hidden = false;
  promptText.focus();
  hideToolbar();
}

toolbar.addEventListener("mousedown", (event) => {
  // 保住选区：不这样，浏览器会在 click 之前把选区清掉。
  event.preventDefault();
});

toolbar.addEventListener("click", (event) => {
  const kind = event.target.dataset?.kind;
  if (!kind) return;
  if (kind === "delete") {
    if (!lastRange) return;
    const quote = lastRange.toString();
    if (!quote) return;
    addComment("delete", quote, "", occurrenceFor(lastRange));
    lastRange = null;
    window.getSelection()?.removeAllRanges();
    hideToolbar();
    return;
  }
  askForText(kind);
});

document.addEventListener("selectionchange", () => {
  if (!promptForm.hidden) return;
  showToolbar();
});

page.addEventListener("change", () => {
  updateBar();
  if (comments.length === 0) say("选项已改。点『发送给 Agent』就行。");
});

page.addEventListener("click", (event) => {
  const mark = event.target.closest?.("mark[data-comment]");
  selectedId = mark ? mark.dataset.comment : null;
  if (selectedId) {
    const found = comments.find((item) => item.id === selectedId);
    say(found ? `${found.kind}：${found.text || found.quote}` : "");
  }
  updateBar();
});

removeButton.addEventListener("click", () => {
  comments = comments.filter((item) => item.id !== selectedId);
  selectedId = null;
  paintComments();
  say("已移除。");
});

/* ---------- 保存 ---------- */

saveButton.addEventListener("click", async () => {
  if (!writable) {
    say("这个文件在 mod 之外，不能写入。");
    return;
  }
  const controls = readControls();
  if (comments.length === 0 && sameControls(controls, baseline)) {
    say("没有可发送的内容：先加批注，或改一下页面上的选项。");
    return;
  }
  saveButton.disabled = true;
  say("正在发送…");
  const next = withBlock(source, comments, controls);
  const result = await request("editor:save", { data: next, baseRevision: revision });
  if (result?.type === "editor:saved") {
    revision = result.revision;
    source = next;
    baseline = readControls();
    savedSinceLoad = true;
    say("已写入页面。正在通知 agent…");
    // 让面板替玩家把 /page-annotated 发进会话（产品的编辑器桥动作 `editor:sendPrompt`）。
    // pi 会把这条模板展开成提示词，agent 于是知道要去读批注块。
    const sent = await request("editor:sendPrompt", { text: "/page-annotated" });
    if (sent?.type === "editor:sent") {
      say("已发送给 agent。它会去读批注，然后改 mod。");
    } else {
      const code = sent?.code ?? "NO_REPLY";
      // 旧版 app 没有这个桥动作，或宿主拒了（错误码写明原因）
      say(SEND_ERROR_TEXT[code] ?? `已写入页面。发送失败（${code}）：到对话里发送 /page-annotated。`);
    }
  } else {
    const code = result?.code ?? "SAVE_FAILED";
    say(SAVE_ERROR_TEXT[code] ?? `发送失败：${code}`);
  }
  saveButton.disabled = !writable;
});

/* ---------- 宿主桥 ---------- */

/** 宿主给的两样：明暗主题，和它当前生效的界面字体栈（皮肤可能换字体）。 */
function setTheme(data) {
  if (data.theme) document.body.dataset.theme = data.theme;
  if (typeof data.fontFamily === "string" && data.fontFamily) {
    document.documentElement.style.setProperty("--app-font", data.fontFamily);
  }
}

window.addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (data.type === "editor:init") {
    writable = data.writable === true;
    setTheme(data);
    if (!writable) saveButton.title = "这个文件在 mod 之外，不能写入。";
    post({ type: "editor:readFile", requestId: `r${++seq}` });
    return;
  }
  if (data.type === "editor:theme") {
    setTheme(data);
    return;
  }
  if (data.type === "editor:fileContent") {
    const reload = pendingReload;
    pendingReload = null;
    const incoming = data.revision ?? null;
    // 内容没变（例如刚刚是我们自己保存触发的变化）→ 什么都不做，别把状态栏盖掉。
    if (reload === "changed" && incoming !== null && incoming === revision) return;
    const dropped = comments.length > 0 && !savedSinceLoad;
    revision = incoming;
    source = typeof data.data === "string" ? data.data : "";
    const block = readBlock(source);
    comments = block.comments;
    renderPage(source);
    applyControls(block.controls);
    baseline = readControls();
    savedSinceLoad = false;
    paintComments();
    if (reload) {
      const head = reload === "changed" ? "页面已被重写" : "已重新载入";
      say(dropped ? `${head}：未发出的批注已作废。` : `${head}：已是最新版。`);
    } else {
      say(comments.length ? "上一轮的批注已显示。" : "选中文字后可以标批注。");
    }
    return;
  }
  if (data.type === "editor:fileChanged") {
    // 打开的文件被改过（agent 重写了页面）。直接重读，旧批注作废。
    reloadFromDisk("changed");
    return;
  }
  if (data.type === "editor:saved" || data.type === "editor:sent" || data.type === "editor:error") {
    settle(data.requestId, data);
  }
});
