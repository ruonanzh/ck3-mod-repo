#!/usr/bin/env node
/**
 * No hard wrapping, for markdown that an agent reads.
 *
 * A paragraph or a list item is one line. A wrap at about 100 columns puts a newline in the middle of
 * a sentence, so the model reads a broken sentence, a `grep` for that sentence misses it, and a
 * `git diff` touches two lines for one word. This checker and fixer joins every block back into one
 * line and leaves it there.
 *
 * Applies to hand-written markdown that an agent reads: `AGENTS.md`, `README.md`, `docs/*.md`, the
 * skills, the agents, and `scripts/README.md`.
 *
 * Usage:
 *   node scripts/check-md-lines.mjs            check the default set, exit 1 on a violation
 *   node scripts/check-md-lines.mjs --list     list every violation as file:line: text
 *   node scripts/check-md-lines.mjs --fix      rewrite in place
 *   node scripts/check-md-lines.mjs FILE...    check only these files
 *
 * Not applied to: fenced code, the YAML header, tables, headings, html blocks, and blockquotes.
 * Vendored snapshots (docs/wiki, docs/script_docs, docs/data_types, reference, .pi/vendor) are
 * never rewritten. The hand-written `docs/wiki/INDEX.md` is the one exception.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = [
  ".git",
  "node_modules",
  "game-scripts",
  ".pi/vendor",
  "docs/wiki",
  "docs/script_docs",
  "docs/data_types",
  "reference",
  "your_mods",
];
/** Hand-written files inside a vendored snapshot still follow this rule. */
const KEEP = new Set(["docs/wiki/INDEX.md"]);

const isBlank = (line) => line.trim() === "";
const isFence = (line) => /^\s*(```|~~~)/.test(line);
const isTable = (line) => /^\s*\|/.test(line);
const isHeading = (line) => /^\s*#{1,6}\s/.test(line);
const isHr = (line) => /^\s*([-*_])\1{2,}\s*$/.test(line);
const isHtml = (line) => /^\s*</.test(line);
const isQuote = (line) => /^\s*>/.test(line);
const isListStart = (line) => LIST_ITEM.test(line);
const isSpecial = (line) =>
  isFence(line) || isTable(line) || isHeading(line) || isHr(line) || isHtml(line) || isQuote(line);

function isSkipped(rel) {
  return SKIP_DIRS.some((skip) => rel === skip || rel.startsWith(`${skip}/`));
}

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      const skipped = isSkipped(rel);
      if (skipped && ![...KEEP].some((keep) => keep.startsWith(`${rel}/`))) continue;
      collectFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      if (isSkipped(rel) && !KEEP.has(rel)) continue;
      out.push(rel);
    }
  }
}

const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+/;
const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;

/** Join two lines with one space, unless both sides are CJK text. */
function joinLines(left, right) {
  if (CJK.test(left.slice(-1)) && CJK.test(right.trim().slice(0, 1))) return `${left}${right.trim()}`;
  return `${left} ${right.trim()}`;
}

function analyse(lines) {
  const violations = [];
  let inFence = false;
  let inHeader = lines[0]?.trim() === "---";
  let extended = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (inHeader) {
      if (i > 0 && /^---\s*$/.test(line)) inHeader = false;
      continue;
    }
    if (isFence(line)) {
      inFence = !inFence;
      extended = false;
      continue;
    }
    if (inFence) continue;
    if (isBlank(line)) {
      extended = false;
      continue;
    }
    if (isSpecial(line)) {
      extended = false;
      continue;
    }
    // A list item starts a new block. Any other non-blank line continues the block above it.
    const startsBlock = isListStart(line);
    if (startsBlock) extended = false;
    if (extended) {
      violations.push({ line: i + 1, text: line.trim(), reason: "continues the line above" });
    }
    extended = true;
  }
  return violations;
}

function rewrite(text) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false;
  let inHeader = lines[0]?.trim() === "---";
  let block = null;

  const flush = () => {
    if (!block) return;
    const first = block[0];
    const marker = LIST_ITEM.exec(first);
    // Prefix of the first line, and the indent that hanging lines line up under.
    const firstPrefix = marker ? `${marker[1]}${marker[2]} ` : /^\s*/.exec(first)[0];
    const bodyStart = marker ? first.slice(marker[0].length) : first.trimStart();
    let joined = bodyStart;
    for (const line of block.slice(1)) joined = joinLines(joined, line);
    out.push(firstPrefix + joined);
    block = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (inHeader) {
      out.push(line);
      if (i > 0 && /^---\s*$/.test(line)) inHeader = false;
      continue;
    }
    if (isFence(line)) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (isBlank(line) || isSpecial(line)) {
      flush();
      out.push(line);
      continue;
    }
    if (isListStart(line)) {
      flush();
      block = [line];
      continue;
    }
    block = block ? [...block, line] : [line];
  }
  flush();
  return out.join("\n");
}

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const list = args.includes("--list");
const only = args.filter((arg) => !arg.startsWith("--"));

const files = [];
if (only.length > 0) files.push(...only.map((file) => path.relative(ROOT, path.resolve(file)).split(path.sep).join("/")));
else collectFiles(ROOT, files);
files.sort();

let total = 0;
let changed = 0;
for (const rel of files) {
  const full = path.join(ROOT, rel);
  const raw = fs.readFileSync(full, "utf8");
  // Keep the file's own newline style: the repo checks out CRLF on Windows.
  const crlf = raw.includes("\r\n");
  const text = crlf ? raw.split("\r\n").join("\n") : raw;
  const lines = text.split("\n");
  const violations = analyse(lines);
  if (violations.length === 0 && !fix) continue;
  if (fix) {
    const next = rewrite(text);
    if (next !== text) {
      const written = crlf ? next.split("\n").join("\r\n") : next;
      fs.writeFileSync(full, written, "utf8");
      changed += 1;
      const after = analyse(next.split("\n")).length;
      console.log(`fixed ${rel} (${violations.length} -> ${after})`);
      total += after;
    } else if (violations.length > 0) {
      console.log(`unfixed ${rel} (${violations.length})`);
      total += violations.length;
    }
    continue;
  }
  total += violations.length;
  for (const violation of violations) {
    if (list) console.log(`${rel}:${violation.line}: ${violation.text.slice(0, 120)}`);
    else console.log(`${rel}:${violation.line}: ${violation.reason}: ${violation.text.slice(0, 90)}`);
  }
}

if (fix) {
  console.log(`\n${changed} file(s) rewritten, ${total} violation(s) left.`);
  process.exit(total === 0 ? 0 : 1);
}
if (total === 0) console.log(`OK: ${files.length} markdown file(s), one block per line.`);
else console.log(`\n${total} violation(s) in ${files.length} markdown file(s).`);
process.exit(total === 0 ? 0 : 1);
