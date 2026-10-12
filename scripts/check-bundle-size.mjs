#!/usr/bin/env node
/**
 * دروازه‌ی بودجه‌ی بسته‌ی اولیه.
 *
 * «بسته‌ی اولیه» یعنی آنچه مرورگر **پیش از اولین رنگ** باید دانلود کند:
 * اسکریپت ورودی در `index.html` به‌علاوه‌ی هر چیزی که با `modulepreload`
 * اعلام شده. چانک‌های تنبل (گزارش‌ها، ECharts) عمداً شمرده نمی‌شوند —
 * کاربر برای دیدن داشبورد منتظرشان نمی‌ماند.
 *
 * اندازه‌گیری روی حجم **gzip** است، چون همان چیزی است که از سیم می‌گذرد.
 *
 * این دروازه به کروم نیاز ندارد و در هر CI‌ای قابل اجراست — برخلاف
 * Lighthouse که به مرورگر و شبکه‌ی پایدار نیاز دارد.
 *
 * FE-087: اگر `apps/web/build/bundle-report.json` (افزونه‌ی `vite-plugins/bundle-report.ts`)
 * باشد، سهم بزرگ‌ترین بسته‌ها در بسته‌ی اولیه هم چاپ می‌شود، **هر بسته‌ای که با دو نسخه
 * در خروجی آمده شکست است**، و خلاصه‌ی markdown در `GITHUB_STEP_SUMMARY` (صفحه‌ی همان
 * اجرای CI) و `apps/web/build/bundle-size.md` نوشته می‌شود. `--details` (اسکریپت `analyze`)
 * ترکیب همه‌ی چانک‌ها را هم نشان می‌دهد. بیلد وب همین دروازه را اجرا می‌کند، پس عبور
 * از بودجه خودِ `pnpm build` را می‌شکند.
 */

import { gzipSync } from 'node:zlib';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'web', 'dist');
const BUILD = join(ROOT, 'apps', 'web', 'build');
const REPORT = join(BUILD, 'bundle-report.json');
const SUMMARY = join(BUILD, 'bundle-size.md');
const DETAILS = process.argv.includes('--details');
const TOP_GROUPS = 12;

/** بودجه‌ی بخش ۶ CLAUDE.md — زیر ۲۰۰KB فشرده. */
const MAX_BUDGET_KB = 200;
/** `BUNDLE_BUDGET_KB` فقط می‌تواند بودجه را سخت‌تر کند، هرگز شل‌تر. */
const requestedBudget = Number(process.env.BUNDLE_BUDGET_KB ?? MAX_BUDGET_KB);
if (!(requestedBudget > 0) || requestedBudget > MAX_BUDGET_KB) {
  console.error(
    `✖ BUNDLE_BUDGET_KB=${process.env.BUNDLE_BUDGET_KB} نامعتبر است: فقط عدد مثبت تا ${MAX_BUDGET_KB} مجاز است. بودجه جابه‌جا نمی‌شود.`,
  );
  process.exit(1);
}
const BUDGET_KB = requestedBudget;

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error('✖ dist/index.html پیدا نشد. اول `pnpm build` را اجرا کن.');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');

// اسکریپت ورودی + هر modulepreload — همان چیزی که مرورگر فوراً می‌گیرد
const entries = new Set();
for (const m of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) entries.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g))
  entries.add(m[1]);

if (entries.size === 0) {
  console.error('✖ هیچ اسکریپتی در index.html پیدا نشد — بیلد مشکوک است.');
  process.exit(1);
}

let totalRaw = 0;
let totalGzip = 0;
const rows = [];

for (const href of [...entries].sort()) {
  const file = join(DIST, href.replace(/^\//, ''));
  if (!existsSync(file)) {
    console.error(`✖ فایل اعلام‌شده در index.html موجود نیست: ${href}`);
    process.exit(1);
  }
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  totalRaw += buf.length;
  totalGzip += gz;
  rows.push({ href, raw: buf.length, gz });
}

const kb = (n) => (n / 1024).toFixed(1);

console.log('بسته‌ی اولیه (بدون چانک‌های تنبل):\n');
for (const r of rows) {
  console.log(`  ${r.href.padEnd(42)} ${kb(r.raw).padStart(8)} KB  →  ${kb(r.gz).padStart(7)} KB gzip`);
}
console.log(`  ${''.padEnd(42, '─')} ${''.padStart(8, '─')}     ${''.padStart(7, '─')}`);
console.log(`  ${'مجموع'.padEnd(42)} ${kb(totalRaw).padStart(8)} KB  →  ${kb(totalGzip).padStart(7)} KB gzip`);

const usedPercent = ((totalGzip / 1024 / BUDGET_KB) * 100).toFixed(0);
console.log(`\nبودجه: ${BUDGET_KB} KB فشرده — مصرف‌شده ${kb(totalGzip)} KB (${usedPercent}٪)`);

const failures = [];
if (totalGzip / 1024 > BUDGET_KB) {
  failures.push(
    `بسته‌ی اولیه از بودجه عبور کرد: ${kb(totalGzip)} KB > ${BUDGET_KB} KB. ` +
      'یا وابستگی را تنبل کن (dynamic import)، یا سبک‌ترش کن. بودجه جابه‌جا نمی‌شود.',
  );
}

const md = [
  '## بودجه‌ی بسته‌ی اولیه',
  '',
  `**${kb(totalGzip)} KB gzip از ${BUDGET_KB} KB (${usedPercent}٪)**`,
  '',
  '| فایل | خام | gzip |',
  '|---|---:|---:|',
  ...rows.map((r) => `| \`${r.href}\` | ${kb(r.raw)} KB | ${kb(r.gz)} KB |`),
];

/* ── ترکیب بسته از گزارش افزونه (FE-087) ── */
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : null;
if (report) {
  console.log('\nبزرگ‌ترین سهم‌ها در بسته‌ی اولیه (پیش از gzip):');
  for (const group of report.initialGroups.slice(0, TOP_GROUPS)) {
    console.log(`  ${group.name.padEnd(42)} ${kb(group.bytes).padStart(8)} KB`);
  }

  const lazy = report.chunks.filter((chunk) => !chunk.initial);
  const lazyGzip = lazy.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
  const largest = lazy[0];
  console.log(
    `\nچانک‌های تنبل: ${lazy.length} عدد، ${kb(lazyGzip)} KB gzip — بزرگ‌ترین: ` +
      (largest ? `${largest.fileName} (${kb(largest.gzipBytes)} KB)` : '—'),
  );

  md.push('', '### بزرگ‌ترین سهم‌ها در بسته‌ی اولیه (پیش از gzip)', '', '| بسته / بخش | اندازه |', '|---|---:|');
  for (const group of report.initialGroups.slice(0, TOP_GROUPS)) md.push(`| \`${group.name}\` | ${kb(group.bytes)} KB |`);
  md.push('', `چانک‌های تنبل: ${lazy.length} عدد، ${kb(lazyGzip)} KB gzip.`);

  if (report.duplicates.length > 0) {
    const list = report.duplicates.map((d) => `${d.name} (${d.versions.join('، ')})`).join('؛ ');
    failures.push(`بسته با چند نسخه در خروجی: ${list}. با override در pnpm-workspace.yaml یکی کن.`);
  } else {
    console.log('✔ هیچ بسته‌ای با دو نسخه در خروجی نیست.');
  }

  if (DETAILS) {
    console.log('\nترکیب همه‌ی چانک‌ها:');
    for (const chunk of report.chunks) {
      console.log(`\n  ${chunk.initial ? '[اولیه]' : '[تنبل] '} ${chunk.fileName} — ${kb(chunk.gzipBytes)} KB gzip`);
      for (const group of chunk.groups.slice(0, 6)) {
        console.log(`      ${group.name.padEnd(38)} ${kb(group.bytes).padStart(8)} KB`);
      }
    }
  }
} else {
  console.log('\n(گزارش ترکیب بسته پیدا نشد — بیلد بدون افزونه‌ی bundle-report اجرا شده؟)');
}

md.push('', failures.length > 0 ? failures.map((f) => `**✖ ${f}**`).join('\n\n') : '✔ داخل بودجه، بدون بسته‌ی تکراری.');
const markdown = `${md.join('\n')}\n`;
if (existsSync(BUILD)) writeFileSync(SUMMARY, markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);

if (failures.length > 0) {
  for (const failure of failures) console.error(`\n✖ ${failure}`);
  process.exit(1);
}

console.log('\n✔ بسته‌ی اولیه داخل بودجه است.');
