#!/usr/bin/env node
/**
 * محک ممنوعیت‌های فرانت — FE-109.
 *
 * `eslint apps/web …` فقط می‌گوید کد فعلی تمیز است؛ اگر روزی یک override قاعده‌ای را خاموش کند یا
 * الگویش بشکند، همان lint بی‌صدا سبز می‌ماند. این اسکریپت با **همان `eslint.config.js`** چند قطعه‌ی
 * عمداً خطا را روی مسیرهای واقعی فرانت lint می‌کند و انتظار دارد هر کدام دقیقاً با قاعده‌ی خودش رد
 * شود — و نمونه‌های مجاز (`ms-2`، `rtl:slide-in-from-left`، import از `@gold/contracts`) رد نشوند.
 *
 * خانواده‌ها: ممنوعیت شناور مالی (گرد کردن، parseFloat، toFixed، Number، any، ts-ignore)،
 * کلاس‌های جهت‌دار، و import از بک‌اند. هیچ فایلی روی دیسک نوشته نمی‌شود (`lintText`).
 *
 * اجرا: `node scripts/check-frontend-bans.mjs` (بخشی از `pnpm gate:frontend`)
 */
import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** مسیرهای ساختگی ولی واقعی‌نما — پیکربندی بر اساس همین مسیرها انتخاب می‌شود. */
const WEB_FILE = 'apps/web/src/features/gate-probe/GateProbe.tsx';
const CORE_FILE = 'packages/core-calc/src/gate-probe.ts';
const CONTRACTS_FILE = 'packages/contracts/src/gate-probe.ts';

const FLOAT = 'no-restricted-syntax';

/**
 * `expect`: قاعده و تکه‌ای از پیامی که باید بیاید؛ `null` یعنی نمونه‌ی مجاز — هیچ خطایی از
 * `watch` نباید بیاید (بقیه‌ی قواعد مثل unused-vars برای نمونه‌ی مجاز مهم نیستند).
 */
const PROBES = [
  // ── ممنوعیت شناور مالی ──
  {
    family: 'float',
    file: WEB_FILE,
    code: 'export const a = (x: number) => Math.round(x);',
    expect: [FLOAT, 'rounding.ts'],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: 'export const a = (x: number) => Math.floor(x);',
    expect: [FLOAT, 'rounding.ts'],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: "export const a = parseFloat('1.5');",
    expect: ['no-restricted-globals', 'parseFloat'],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: "export const a = Number.parseFloat('1.5');",
    expect: [FLOAT, 'Number.parseFloat'],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: 'export const a = (x: number) => x.toFixed(2);',
    expect: [FLOAT, 'toFixed'],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: "export const a = Number('12500000');",
    expect: [FLOAT, 'Number()'],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: 'export const a = (x: any) => x;',
    expect: ['@typescript-eslint/no-explicit-any', ''],
  },
  {
    family: 'float',
    file: WEB_FILE,
    code: '// @ts-ignore\nexport const a: string = 1;',
    expect: ['@typescript-eslint/ban-ts-comment', ''],
  },
  {
    family: 'float',
    file: CORE_FILE,
    code: 'export const a = (x: number) => Math.round(x);',
    expect: [FLOAT, 'rounding.ts'],
  },
  {
    family: 'float',
    file: CONTRACTS_FILE,
    code: "export const a = parseFloat('1');",
    expect: ['no-restricted-globals', 'parseFloat'],
  },

  // ── کلاس‌های جهت‌دار ──
  {
    family: 'direction',
    file: WEB_FILE,
    code: 'export const A = () => <div className="ml-2" />;',
    expect: [FLOAT, 'RTL'],
  },
  {
    family: 'direction',
    file: WEB_FILE,
    code: 'export const A = () => <div className="flex sm:text-left" />;',
    expect: [FLOAT, 'RTL'],
  },
  {
    family: 'direction',
    file: WEB_FILE,
    code: 'export const A = () => <div className="absolute right-0" />;',
    expect: [FLOAT, 'RTL'],
  },
  {
    family: 'direction',
    file: WEB_FILE,
    code: 'export const c = (x: string) => `pr-4 ${x}`;',
    expect: [FLOAT, 'RTL'],
  },
  {
    family: 'direction',
    file: WEB_FILE,
    code: "export const c = 'rounded-tl-lg';",
    expect: [FLOAT, 'RTL'],
  },
  {
    family: 'direction',
    file: WEB_FILE,
    code: 'export const A = () => <div className="ms-2 pe-4 text-start end-0" />;',
    expect: null,
    watch: FLOAT,
  },
  {
    family: 'direction',
    file: WEB_FILE,
    code: "export const c = 'data-[state=open]:rtl:slide-in-from-left';",
    expect: null,
    watch: FLOAT,
  },

  // ── import از بک‌اند ──
  {
    family: 'backend-import',
    file: WEB_FILE,
    code: "export { AppModule } from '@gold/api';",
    expect: ['no-restricted-imports', 'apps/api'],
  },
  {
    family: 'backend-import',
    file: WEB_FILE,
    code: "export * from '@gold/api/src/main';",
    expect: ['no-restricted-imports', 'apps/api'],
  },
  {
    family: 'backend-import',
    file: WEB_FILE,
    code: "export * from '../../../../../apps/api/src/modules/ledger/ledger.service';",
    expect: ['no-restricted-imports', 'apps/api'],
  },
  {
    family: 'backend-import',
    file: CORE_FILE,
    code: "export * from '@gold/api';",
    expect: ['no-restricted-imports', 'apps/api'],
  },
  {
    family: 'backend-import',
    file: CONTRACTS_FILE,
    code: "export * from '@gold/api';",
    expect: ['no-restricted-imports', 'apps/api'],
  },
  {
    family: 'backend-import',
    file: WEB_FILE,
    code: "export * from '@gold/contracts';",
    expect: null,
    watch: 'no-restricted-imports',
  },
];

const eslint = new ESLint({ cwd: ROOT });
const failures = [];

for (const probe of PROBES) {
  const [result] = await eslint.lintText(probe.code, { filePath: join(ROOT, probe.file) });
  const messages = result?.messages ?? [];
  const label = `${probe.family} · ${probe.file} · ${probe.code.replace(/\n/g, ' ⏎ ')}`;

  if (messages.some((message) => message.fatal)) {
    failures.push(
      `${label}\n    قطعه parse نشد یا فایل ignore شد: ${messages.map((m) => m.message).join(' | ')}`,
    );
    continue;
  }
  if (probe.expect === null) {
    const hits = messages.filter((message) => message.ruleId === probe.watch);
    if (hits.length > 0)
      failures.push(`${label}\n    نمونه‌ی مجاز رد شد: ${hits.map((m) => m.message).join(' | ')}`);
    continue;
  }
  const [ruleId, fragment] = probe.expect;
  const caught = messages.some(
    (message) => message.ruleId === ruleId && message.message.includes(fragment),
  );
  if (!caught) {
    const seen = messages.map((m) => `${m.ruleId}: ${m.message}`).join(' | ') || 'هیچ پیامی';
    failures.push(
      `${label}\n    انتظار: ${ruleId}${fragment ? ` («${fragment}»)` : ''} — دیده شد: ${seen}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `✗ ${failures.length} از ${PROBES.length} محک ممنوعیت شکست خورد — قاعده خاموش یا شکسته است:\n`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const families = [...new Set(PROBES.map((probe) => probe.family))];
console.log(`✓ ${PROBES.length} محک ممنوعیت (${families.join('، ')}) — همه‌ی قواعد فعال‌اند.`);
