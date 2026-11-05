#!/usr/bin/env node
/**
 * 主题 token 化 codemod（TASK-040/041）
 * 把硬编码 Tailwind 色板类替换为 globals.css 中定义的语义 token 类。
 * 规则见 docs/theme-tokens.md。全部使用正则 + 后缀边界（避免
 * `bg-slate-50` 误伤 `bg-slate-500`），并按 pattern 长度降序替换，
 * 保证 `dark:text-slate-400`（删除）先于 `text-slate-400`（→ faint）生效。
 * 用法: node scripts/theme-codemod.mjs <file...>   （原地改写）
 */
import fs from "node:fs";

const rules = [];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** 精确匹配一个 class 字面量：右侧不能紧跟 字母数字 - / :（防前缀误伤） */
const add = (from, to) =>
  rules.push([new RegExp(esc(from) + "(?![\\w/:-])", "g"), to]);
const addRe = (re, to) => rules.push([re, to]);
/** 删除类：连同类名前的空格一起吞掉，避免留下多余空白 */
const del = (cls) =>
  rules.push([new RegExp("\\s?" + esc(cls) + "(?![\\w/:-])", "g"), ""]);
const delRe = (re) => rules.push([re, ""]);

/* ---------- 中性：dark: 成对写法删除（先透明度变体） ---------- */
for (const cls of [
  "dark:bg-slate-900", "dark:bg-slate-950", "dark:bg-slate-800",
  "dark:bg-slate-700", "dark:bg-slate-600",
  "dark:text-slate-100", "dark:text-slate-200", "dark:text-slate-300",
  "dark:text-slate-400", "dark:text-slate-500", "dark:text-slate-600",
  "dark:border-slate-800", "dark:border-slate-700",
  "dark:hover:bg-slate-900", "dark:hover:bg-slate-800", "dark:hover:bg-slate-700",
  "dark:hover:text-slate-100", "dark:hover:text-slate-200", "dark:hover:text-slate-300",
  "dark:divide-slate-800", "dark:placeholder:text-slate-500",
]) {
  delRe(new RegExp("\\s?" + esc(cls) + "/\\d+", "g"));
  del(cls);
}

/* ---------- 中性：亮侧 → token ---------- */
const neutral = [
  ["bg-white", "bg-card"],
  ["bg-slate-50", "bg-surface-sunken"],
  ["bg-slate-100", "bg-muted"],
  ["bg-slate-200", "bg-surface-raised"],
  ["bg-slate-300", "bg-surface-raised"],
  ["bg-slate-900", "bg-surface-inverse"],
  ["bg-slate-950", "bg-surface-inverse"],
  ["text-slate-900", "text-foreground"],
  ["text-slate-800", "text-foreground-strong"],
  ["text-slate-700", "text-foreground-subtle"],
  ["text-slate-600", "text-foreground-subtle"],
  ["text-slate-500", "text-muted-foreground"],
  ["text-slate-400", "text-foreground-faint"],
  ["text-slate-300", "text-foreground-faint"],
  ["text-slate-100", "text-surface-inverse-foreground"],
  ["border-slate-200", "border-border"],
  ["border-slate-100", "border-border-subtle"],
  ["border-slate-300", "border-border-strong"],
  ["divide-slate-100", "divide-border-subtle"],
  ["hover:bg-slate-50", "hover:bg-surface-sunken"],
  ["hover:bg-slate-100", "hover:bg-muted"],
  ["hover:bg-slate-200", "hover:bg-surface-raised"],
  ["hover:text-slate-900", "hover:text-foreground"],
  ["hover:text-slate-800", "hover:text-foreground-strong"],
  ["hover:text-slate-700", "hover:text-foreground-subtle"],
  ["hover:text-slate-600", "hover:text-foreground-subtle"],
];
for (const [from, to] of neutral) {
  addRe(new RegExp(esc(from) + "(/\\d+)(?![\\w/:-])", "g"), to + "$1");
  add(from, to);
}

/* ---------- 状态/强调色 ---------- */
const hues = [
  ["blue", "info"], ["emerald", "success"], ["amber", "warning"],
  ["rose", "danger"], ["purple", "brand"], ["sky", "sky"],
  ["indigo", "indigo"], ["violet", "violet"],
];
for (const [c, t] of hues) {
  // dark: 成对删除（透明度变体优先）
  for (const dark of [
    `dark:bg-${c}-950`, `dark:bg-${c}-900`, `dark:bg-${c}-700`,
    `dark:bg-${c}-600`, `dark:bg-${c}-500`,
    `dark:text-${c}-200`, `dark:text-${c}-300`, `dark:text-${c}-400`,
    `dark:border-${c}-700`, `dark:border-${c}-800`, `dark:border-${c}-900`,
    `dark:hover:bg-${c}-950`, `dark:hover:text-${c}-400`, `dark:hover:border-${c}-700`,
  ]) {
    delRe(new RegExp("\\s?" + esc(dark) + "/\\d+", "g"));
    del(dark);
  }
  // 带透明度的特殊形态（先于普通规则）
  addRe(new RegExp(esc(`bg-${c}-500`) + "/10", "g"), `bg-${t}-solid/10`);
  addRe(new RegExp(esc(`bg-${c}-950`) + "/(\\d+)", "g"), `bg-${t}-solid/$1`);
  addRe(new RegExp(esc(`border-${c}-500`) + "/30", "g"), `border-${t}-solid/30`);
  addRe(new RegExp(esc(`text-${c}-600`) + "/80", "g"), `text-${t}-fg/80`);
  addRe(new RegExp(esc(`bg-${c}-50`) + "/(\\d+)", "g"), `bg-${t}-soft/$1`);
  // 浅底
  add(`bg-${c}-50`, `bg-${t}-soft`);
  add(`bg-${c}-100`, `bg-${t}-soft-strong`);
  add(`bg-${c}-200`, `bg-${t}-soft-strong`);
  add(`hover:bg-${c}-50`, `hover:bg-${t}-soft`);
  add(`hover:bg-${c}-100`, `hover:bg-${t}-soft-hover`);
  add(`hover:bg-${c}-200`, `hover:bg-${t}-soft-hover`);
  // 文字
  add(`text-${c}-400`, `text-${t}-fg`);
  add(`text-${c}-500`, `text-${t}-fg`);
  add(`text-${c}-600`, `text-${t}-fg`);
  add(`text-${c}-700`, `text-${t}-fg-strong`);
  add(`text-${c}-800`, `text-${t}-fg-strong`);
  add(`text-${c}-900`, `text-${t}-fg-strong`);
  add(`hover:text-${c}-500`, `hover:text-${t}-fg`);
  add(`hover:text-${c}-600`, `hover:text-${t}-fg`);
  // 边框
  add(`border-${c}-100`, `border-${t}-border`);
  add(`border-${c}-200`, `border-${t}-border`);
  add(`border-${c}-300`, `border-${t}-border-strong`);
  add(`border-${c}-400`, `border-${t}-border-strong`);
  add(`hover:border-${c}-300`, `hover:border-${t}-border-strong`);
  // 实心
  add(`bg-${c}-400`, `bg-${t}-solid`);
  add(`bg-${c}-500`, `bg-${t}-solid`);
  add(`bg-${c}-600`, `bg-${t}-solid`);
  add(`bg-${c}-950`, `bg-${t}-solid`);
  add(`hover:bg-${c}-700`, `hover:bg-${t}-solid-hover`);
}

/* ---------- 焦点环 ---------- */
add("focus-within:ring-blue-500", "focus-within:ring-ring");
add("focus:ring-blue-500", "focus:ring-ring");
add("ring-blue-500", "ring-ring");
add("focus-within:border-blue-500", "focus-within:border-ring");
add("focus:border-blue-500", "focus:border-ring");
add("border-blue-500", "border-info-border-strong");
add("border-blue-600", "border-info-border-strong");

// 长的 pattern 先替换
rules.sort((a, b) => String(b[0].source ?? b[0]).length - String(a[0].source ?? a[0]).length);

let totalChanged = 0;
for (const file of process.argv.slice(2)) {
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  for (const [pattern, to] of rules) src = src.replace(pattern, to);
  if (src !== before) {
    fs.writeFileSync(file, src);
    totalChanged++;
    console.log("updated:", file);
  }
}
console.log(`done, ${totalChanged} file(s) changed`);
