#!/usr/bin/env node
/**
 * محک ممنوعیت‌های بک‌اند — BE-071.
 *
 * سه لایه، هر شکست با «مسیر:خط [قانون] توضیح»:
 *
 * ۱. **قواعد ESLint واقعاً فعال‌اند.** `eslint apps/api` فقط می‌گوید کد فعلی تمیز است؛ اگر
 *    یک override قاعده‌ای را برای بک‌اند خاموش کند، lint بی‌صدا سبز می‌ماند. پس قطعه‌های عمداً
 *    خطا (گرد کردن، parseFloat، toFixed، Number، any، ts-ignore) روی مسیرهای واقعی بک‌اند با
 *    **همان `eslint.config.js`** lint می‌شوند و هر کدام باید با قاعده‌ی خودش رد شود.
 * ۲. **پول و وزن با `number`** در سه جای تعریف نوع: ستون Drizzle، قرارداد zod، و نوع TypeScript
 *    در `apps/api/src`. پول ریال است، وزن میلی‌گرم/میکروگرم؛ همه bigint و روی سیم رشته.
 * ۳. **خاموش کردن قاعده در کد** (`eslint-disable` برای همین قواعد، `@ts-nocheck`) — وگرنه هر
 *    ممنوعیتی با یک کامنت دور زده می‌شد.
 *
 * اجرا: `node scripts/check-backend-bans.mjs` (بخشی از `pnpm gate:backend`)
 */
import { ESLint } from 'eslint';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_FILE = 'apps/api/src/modules/gate-probe/gate-probe.service.ts';
const API_TEST_FILE = 'apps/api/test/gate-probe.e2e-spec.ts';
const CORE_FILE = 'packages/core-calc/src/gate-probe.ts';
const FLOAT = 'no-restricted-syntax';

// ── ۱. محک ESLint ──────────────────────────────────────────────────────────

const PROBES = [
  { rule: 'no-math-round', file: API_FILE, code: 'export const a = (x: number) => Math.round(x);', expect: [FLOAT, 'rounding.ts'] },
  { rule: 'no-math-round', file: API_FILE, code: 'export const a = (x: number) => Math.floor(x);', expect: [FLOAT, 'rounding.ts'] },
  { rule: 'no-math-round', file: API_FILE, code: 'export const a = (x: number) => Math.ceil(x);', expect: [FLOAT, 'rounding.ts'] },
  { rule: 'no-math-round', file: API_FILE, code: 'export const a = (x: number) => Math.trunc(x);', expect: [FLOAT, 'rounding.ts'] },
  { rule: 'no-math-round', file: API_TEST_FILE, code: 'export const a = (x: number) => Math.round(x);', expect: [FLOAT, 'rounding.ts'] },
  { rule: 'no-math-round', file: CORE_FILE, code: 'export const a = (x: number) => Math.round(x);', expect: [FLOAT, 'rounding.ts'] },
  { rule: 'no-float-parse', file: API_FILE, code: "export const a = parseFloat('1.5');", expect: ['no-restricted-globals', 'parseFloat'] },
  { rule: 'no-float-parse', file: API_FILE, code: "export const a = Number.parseFloat('1.5');", expect: [FLOAT, 'Number.parseFloat'] },
  { rule: 'no-to-fixed', file: API_FILE, code: 'export const a = (x: number) => x.toFixed(2);', expect: [FLOAT, 'toFixed'] },
  { rule: 'no-number-cast', file: API_FILE, code: 'export const a = (x: bigint) => Number(x);', expect: [FLOAT, 'Number()'] },
  { rule: 'no-any', file: API_FILE, code: 'export const a = (x: any) => x;', expect: ['@typescript-eslint/no-explicit-any', ''] },
  { rule: 'no-ts-ignore', file: API_FILE, code: '// @ts-ignore\nexport const a: string = 1;', expect: ['@typescript-eslint/ban-ts-comment', ''] },
  // نمونه‌های مجاز — نباید رد شوند.
  { rule: 'allowed', file: API_FILE, code: 'export const a = (x: number, y: number) => Math.max(x, y);', expect: null, watch: FLOAT },
  { rule: 'allowed', file: 'packages/core-calc/src/rounding.ts', code: 'export const a = (x: number) => Math.round(x);', expect: null, watch: FLOAT },
];

async function lintProbes() {
  const eslint = new ESLint({ cwd: ROOT });
  const failures = [];
  for (const probe of PROBES) {
    const [result] = await eslint.lintText(probe.code, { filePath: join(ROOT, probe.file) });
    const messages = result?.messages ?? [];
    const label = `${probe.file} [${probe.rule}] ${probe.code.replace(/\n/g, ' ⏎ ')}`;

    if (messages.some((message) => message.fatal)) {
      failures.push(`${label}\n      قطعه parse نشد یا فایل ignore شد: ${messages.map((m) => m.message).join(' | ')}`);
      continue;
    }
    if (probe.expect === null) {
      const hits = messages.filter((message) => message.ruleId === probe.watch);
      if (hits.length > 0) failures.push(`${label}\n      نمونه‌ی مجاز رد شد: ${hits.map((m) => m.message).join(' | ')}`);
      continue;
    }
    const [ruleId, fragment] = probe.expect;
    if (!messages.some((message) => message.ruleId === ruleId && message.message.includes(fragment))) {
      const seen = messages.map((m) => `${m.ruleId}: ${m.message}`).join(' | ') || 'هیچ پیامی';
      failures.push(`${label}\n      قاعده برای بک‌اند خاموش است — انتظار ${ruleId}، دیده شد: ${seen}`);
    }
  }
  return failures;
}

// ── ۲ و ۳. پیمایش منبع ─────────────────────────────────────────────────────

/**
 * نام فیلدی که پول یا وزن است. پسوند واحد (Rial، Mg، Ug) قرارداد نام‌گذاری کل مخزن است؛
 * چند نام بی‌پسوند رایج هم صریحاً آمده‌اند. تعداد سکه، عیار، نسخه و شماره‌ی فاکتور عمداً
 * اینجا نیستند: آن‌ها `number` ِ مجازند (CLAUDE.md ۲-۱).
 *
 * `quantity` عمداً در این فهرست نیست: در دفتر کل و موجودی مقدار ِ بُعد (ریال، میلی‌گرم) است، ولی
 * در قلم فاکتور تعداد قطعه/سکه است — عدد صحیح ِ مجاز. قاعده‌ی دقیق‌ترش پایین‌تر است.
 */
const MONEY_OR_WEIGHT = /(?:Rial|Mg|Ug)$|^(?:amount|price|weight|balance|payable|paid|receivable|bubble)$/u;

const SCANS = [
  {
    rule: 'money-weight-db-type',
    dir: 'apps/api/src/platform/database/schema',
    pattern: /\b(\w+):\s*(integer|smallint|real|doublePrecision|numeric|decimal|serial)\(/gu,
    message: (key, type) => `ستون «${key}» پول/وزن است ولی ${type}() — باید bigint({ mode: 'bigint' }) باشد`,
  },
  {
    rule: 'money-weight-db-type',
    dir: 'apps/api/src/platform/database/schema',
    pattern: /\b(\w+):\s*bigint\(\{\s*mode:\s*'number'/gu,
    any: true,
    message: (key) => `ستون «${key}» bigint با mode: 'number' است — دقت بالای ۲^۵۳ بی‌صدا از بین می‌رود`,
  },
  {
    // مقدار دفتر کل و حرکت موجودی (ریال، میلی‌گرم یا تعداد سکه در بُعد خودش) — همیشه bigint.
    rule: 'ledger-quantity-type',
    dir: 'apps/api/src/platform/database/schema',
    only: /(ledger-transactions|inventory-movements)\.ts$/u,
    pattern: /\b(quantity):\s*(?!bigint\(\{\s*mode:\s*'bigint')(\w+)\(/gu,
    any: true,
    message: (key, type) => `ستون «${key}» دفتر کل/موجودی ${type}() است — باید bigint({ mode: 'bigint' }) باشد`,
  },
  {
    rule: 'money-weight-json-number',
    dir: 'packages/contracts/src',
    pattern: /(\w+):\s*z\.(?:coerce\.)?number\(/gu,
    message: (key) => `فیلد قرارداد «${key}» پول/وزن است ولی z.number() — روی سیم باید رشته‌ی عدد صحیح باشد`,
  },
  {
    rule: 'money-weight-ts-number',
    dir: 'apps/api/src',
    skip: /\.spec\.ts$/u,
    pattern: /\b(\w+)\??:\s*number\b/gu,
    message: (key) => `«${key}» پول/وزن است ولی نوعش number — باید bigint باشد`,
  },
];

const SUPPRESSION = {
  rule: 'rule-suppressed',
  dirs: ['apps/api/src', 'apps/api/test', 'apps/api/scripts', 'packages/core-calc/src', 'packages/contracts/src'],
  pattern:
    /(eslint-disable[^\n]*(no-restricted-syntax|no-restricted-globals|no-explicit-any|ban-ts-comment)|eslint-disable(?:-next-line|-line)?\s*(?:\*\/|$)|@ts-nocheck)/u,
};

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name === 'dist') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|mts|mjs)$/u.test(name) ? [path] : [];
  });
}

function scanSources() {
  const failures = [];
  for (const scan of SCANS) {
    for (const file of walk(join(ROOT, scan.dir))) {
      if (scan.skip?.test(file)) continue;
      if (scan.only !== undefined && !scan.only.test(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          // یک خط ممکن است چند ستون/فیلد داشته باشد؛ همه بررسی می‌شوند، نه فقط اولی.
          for (const match of line.matchAll(scan.pattern)) {
            if (!scan.any && !MONEY_OR_WEIGHT.test(match[1])) continue;
            failures.push(
              `${relative(ROOT, file).replace(/\\/g, '/')}:${index + 1} [${scan.rule}] ${scan.message(match[1], match[2])}`,
            );
          }
        });
    }
  }
  for (const dir of SUPPRESSION.dirs) {
    for (const file of walk(join(ROOT, dir))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (SUPPRESSION.pattern.test(line)) {
            failures.push(
              `${relative(ROOT, file).replace(/\\/g, '/')}:${index + 1} [${SUPPRESSION.rule}] خاموش کردن قاعده‌ی اصلی در کد: ${line.trim()}`,
            );
          }
        });
    }
  }
  return failures;
}

const lintFailures = await lintProbes();
const sourceFailures = scanSources();

if (lintFailures.length + sourceFailures.length > 0) {
  console.error(`✗ ممنوعیت‌های بک‌اند — ${lintFailures.length + sourceFailures.length} نقض:\n`);
  for (const failure of [...lintFailures, ...sourceFailures]) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `✓ ${PROBES.length} محک ESLint (گرد کردن، parseFloat، toFixed، Number، any، ts-ignore) فعال‌اند؛ ` +
    `هیچ پول/وزنی با number و هیچ قاعده‌ی خاموش‌شده‌ای نیست.`,
);
