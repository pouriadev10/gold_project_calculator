#!/usr/bin/env node
/**
 * نگهبان باندل production — FE-093: «mock مالی به production bundle وارد نشود».
 *
 * ESLint (`MOCKS_STAY_DEV_ONLY_PATTERNS`) import ایستای mock را در کد برنامه می‌گیرد؛ این
 * اسکریپت خود خروجی بیلد را می‌گردد، چون فقط خروجی واقعی ثابت می‌کند tree-shaking شاخه‌ی
 * `import.meta.env.DEV` را برداشته است. نشانه‌ها از خود منبع mock خوانده می‌شوند — هر
 * UUID ِ fixture، رمز دمو و نام‌های msw — پس fixture تازه بدون به‌روزرسانی این فایل هم
 * پوشش دارد.
 *
 * اجرا: پس از `vite build` در `pnpm build`؛ یا مستقیم `node scripts/check-no-mocks.mjs [dist]`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(process.argv[2] ?? join(WEB_ROOT, 'dist'));
const MOCK_SOURCES = ['src/mocks/handlers/fixtures.ts', 'src/mocks/handlers/index.ts'].map((path) =>
  join(WEB_ROOT, path),
);
const TEXT_EXTENSIONS = /\.(?:js|mjs|css|html|json|webmanifest|map)$/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

if (!existsSync(DIST)) {
  console.error(`✗ پوشه‌ی خروجی پیدا نشد: ${DIST} — اول vite build`);
  process.exit(1);
}

/** نشانه‌هایی که فقط کد mock دارد؛ هیچ‌کدام در کد برنامه معنی ندارد. */
function markers() {
  const fixtureIds = new Set();
  for (const source of MOCK_SOURCES) {
    for (const match of readFileSync(source, 'utf8').matchAll(UUID)) fixtureIds.add(match[0].toLowerCase());
  }
  return [
    ...[...fixtureIds].map((id) => ({ text: id, why: 'UUID ِ fixture ِ mock' })),
    { text: 'setupWorker', why: 'msw/browser' },
    { text: 'mockServiceWorker', why: 'سرویس‌ورکر msw' },
    { text: '__goldMocks', why: 'سوییچ سناریوی توسعه' },
    { text: 'gold.mockScenario', why: 'سوییچ سناریوی توسعه' },
    { text: 'password123', why: 'رمز کاربر دمو' },
  ];
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(DIST);
const problems = [];

for (const file of files) {
  if (/mockServiceWorker\.js$/u.test(file)) problems.push(`${relative(DIST, file)}: سرویس‌ورکر msw در خروجی است`);
}

const list = markers();
for (const file of files.filter((path) => TEXT_EXTENSIONS.test(path))) {
  const content = readFileSync(file, 'utf8').toLowerCase();
  for (const marker of list) {
    if (content.includes(marker.text.toLowerCase())) {
      problems.push(`${relative(DIST, file)}: «${marker.text}» (${marker.why})`);
    }
  }
}

if (problems.length > 0) {
  console.error('✗ داده یا کد mock به باندل production رسیده است:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`✓ باندل production بدون mock — ${files.length} فایل، ${list.length} نشانه بررسی شد`);
