#!/usr/bin/env node
/**
 * دروازه‌ی نهایی فرانت — FE-109 (جانشین زنجیره‌ی `&&` ِ FE-003).
 *
 * هر بررسی یک مرحله‌ی نام‌دار است تا خروجی بگوید دقیقاً کدام شرط سبز شد و کدام نه. ترتیب از
 * ارزان به گران است و اولین شکست بقیه را متوقف می‌کند (شکست typecheck، build را هم می‌شکند؛
 * ادامه دادن فقط خروجی را شلوغ می‌کند). در پایان جدول همه‌ی مرحله‌ها چاپ می‌شود.
 *
 * تست‌های vitest ِ وب یک بار و فقط یک بار اجرا می‌شوند، تقسیم‌شده بر اساس نام فایل:
 *   integration → `*.integration.test.*`   a11y → `app/a11y.test.tsx`
 *   contracts   → `*contract*.test.*` + تست‌های `packages/contracts`   unit → بقیه (+ core-calc)
 * هر گروهی که فایلی پیدا نکند شکست است (vitest بدون فایل خطا می‌دهد) — دروازه‌ی سبز با صفر تست ممکن نیست.
 *
 * اجرا: `pnpm gate:frontend`
 * گزینه: `--only=<id,id>` فقط همان مرحله‌ها (برای تکرار پس از رفع یک شکست؛ دروازه‌ی کامل نیست).
 * E2E به Chrome یا Edge ِ نصب‌شده (یا `CHROME_PATH`) نیاز دارد — جزئیات در `apps/web/scripts/lib/audit-kit.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WEB_VITEST = 'pnpm --filter @gold/web exec vitest run';
const NOT_UNIT = ['**/*.integration.test.*', '**/a11y.test.tsx', '**/*contract*.test.*'];

/** `commands` پشت سر هم و با shell اجرا می‌شوند؛ cwd همیشه ریشه‌ی مخزن است. */
const STEPS = [
  { id: 'typescript', title: 'TypeScript', commands: ['pnpm --filter "@gold/web..." typecheck'] },
  {
    id: 'eslint',
    title: 'ESLint (web، core-calc، contracts)',
    commands: ['pnpm exec eslint apps/web packages/core-calc packages/contracts'],
  },
  {
    id: 'bans',
    title: 'ممنوعیت float مالی، direction classes و import از backend',
    commands: ['node scripts/check-frontend-bans.mjs'],
  },
  { id: 'circular', title: 'وابستگی دوری', commands: ['pnpm --filter @gold/web check:circular'] },
  {
    id: 'unit',
    title: 'Unit tests',
    commands: [
      'pnpm --filter @gold/core-calc test',
      `${WEB_VITEST} ${NOT_UNIT.map((glob) => `--exclude "${glob}"`).join(' ')}`,
    ],
  },
  { id: 'integration', title: 'Integration tests', commands: [`${WEB_VITEST} .integration.test.`] },
  {
    id: 'a11y',
    title: 'Accessibility smoke test',
    commands: [`${WEB_VITEST} src/app/a11y.test.tsx`],
  },
  {
    id: 'contracts',
    title: 'قراردادهای API',
    commands: ['pnpm --filter @gold/contracts test', `${WEB_VITEST} contract`],
  },
  {
    id: 'build',
    title: 'Build (+ بودجه و نبود mock در خروجی)',
    commands: ['pnpm --filter @gold/web build'],
  },
  { id: 'bundle', title: 'Bundle budget (جزئیات)', commands: ['pnpm --filter @gold/web analyze'] },
  {
    id: 'e2e',
    title: 'E2E critical path (۳۶۰px + دسکتاپ)',
    commands: ['pnpm --filter @gold/web test:e2e'],
  },
];

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;
if (only) {
  const unknown = [...only].filter((id) => !STEPS.some((step) => step.id === id));
  if (unknown.length > 0) {
    console.error(
      `مرحله‌ی ناشناخته: ${unknown.join(', ')} — مرحله‌ها: ${STEPS.map((step) => step.id).join(', ')}`,
    );
    process.exit(2);
  }
}

const formatSeconds = (ms) => `${(ms - (ms % 1000)) / 1000}s`;
const results = [];
let failed = false;

for (const step of STEPS) {
  if (only && !only.has(step.id)) continue;
  if (failed) {
    results.push({ step, status: 'skipped' });
    continue;
  }
  console.log(`\n━━━ [${step.id}] ${step.title} ━━━`);
  const started = Date.now();
  let status = 'passed';
  for (const command of step.commands) {
    console.log(`$ ${command}`);
    const run = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (run.status !== 0) {
      status = 'failed';
      if (run.error) console.error(run.error.message);
      break;
    }
  }
  results.push({ step, status, ms: Date.now() - started });
  if (status === 'failed') failed = true;
}

const MARK = { passed: '✓', failed: '✗', skipped: '·' };
console.log('\n━━━ نتیجه‌ی gate:frontend ━━━');
for (const { step, status, ms } of results) {
  const time = ms === undefined ? 'اجرا نشد' : formatSeconds(ms);
  console.log(`${MARK[status]} ${step.id.padEnd(12)} ${time.padStart(8)}  ${step.title}`);
}
if (only) console.log('(فقط مرحله‌های --only اجرا شد — این دروازه‌ی کامل نیست)');

if (failed) {
  const broken = results.find((result) => result.status === 'failed');
  console.error(
    `\n✗ دروازه‌ی فرانت قرمز است: «${broken.step.title}». تکرار همان مرحله: pnpm gate:frontend --only=${broken.step.id}`,
  );
  process.exit(1);
}
console.log('\n✓ دروازه‌ی فرانت سبز است.');
