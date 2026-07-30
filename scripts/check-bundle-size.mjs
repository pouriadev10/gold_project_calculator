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
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'web', 'dist');

/** بودجه‌ی بخش ۶ CLAUDE.md — زیر ۲۰۰KB فشرده. */
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 200);

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

if (totalGzip / 1024 > BUDGET_KB) {
  console.error(
    `\n✖ بسته‌ی اولیه از بودجه عبور کرد: ${kb(totalGzip)} KB > ${BUDGET_KB} KB.\n` +
      '  یا وابستگی را تنبل کن (dynamic import)، یا سبک‌ترش کن. بودجه جابه‌جا نمی‌شود.',
  );
  process.exit(1);
}

console.log('\n✔ بسته‌ی اولیه داخل بودجه است.');
