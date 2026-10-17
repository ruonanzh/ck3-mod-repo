#!/usr/bin/env node
/**
 * 文档引用自检：markdown 链接 `[..](x.md)` 按**文件相对路径**解析 → 必须存在。
 *
 * 为什么**不**校验反引号里的路径：反引号里既写本仓库文件（仓库根相对），也写其它仓库/工作区
 * 文件（那边的相对路径），两者都合法，机械校验会大量误报。所以只查 markdown 链接这一类。
 *
 * 用法：node scripts/check-doc-refs.mjs   （exit 1 = 有问题）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const problems = [];
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) files.push(p);
  }
})(root);

for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+\.md)(#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|\/\/)/.test(target)) continue;
    if (!existsSync(resolve(dirname(f), target)))
      problems.push(`broken markdown link: ${f} → ${target}`);
  }
}

if (problems.length) {
  for (const p of problems) console.error("  ❌ " + p);
  console.error(`  共 ${problems.length} 处`);
  process.exit(1);
}
console.log(`  ✅ 文档引用自检通过（${files.length} 个 md 文件）`);
