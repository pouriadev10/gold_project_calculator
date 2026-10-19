#!/usr/bin/env node
/**
 * دروازه‌ی نهایی بک‌اند — BE-071. هم‌شکل `gate-frontend.mjs`.
 *
 * هر قانون اصلی CLAUDE.md یک مرحله‌ی نام‌دار است؛ اولین شکست بقیه را متوقف می‌کند و جدول پایانی
 * می‌گوید کدام سبز شد و کدام نه. پیام هر شکست از ابزار همان مرحله می‌آید و مسیر فایل و قانون را
 * دارد: ESLint (`فایل:خط  قانون`)، محک ممنوعیت‌ها و آزمون idempotency (`فایل:خط [قانون]`)، و
 * بررسی مهاجرت (`[migration-drift]`).
 *
 * **دیتابیس خودش را می‌سازد.** تست‌های integration، property ِ دفتر کل و بررسی ناورداها روی یک
 * دیتابیس تازه (`gold_gate`) اجرا می‌شوند که همین‌جا از صفر با همه‌ی مهاجرت‌ها ساخته و در پایان
 * حذف می‌شود — پس «مهاجرت روی دیتابیس خالی اعمال می‌شود» هم آزموده می‌شود و دیتابیس توسعه دست
 * نمی‌خورد. اتصال مدیریتی: `GATE_DATABASE_URL` (پیش‌فرض: PostgreSQL ِ docker compose).
 *
 * اجرا:   pnpm gate:backend
 * گزینه‌ها: --only=<id,id>  فقط همان مرحله‌ها (دروازه‌ی کامل نیست)
 *          --keep-db        دیتابیس gold_gate را برای بررسی نگه دار
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps/api');
const DRIFT_DIR = join(API, '.gate/drizzle-drift');
const GATE_DB = 'gold_gate';
const ADMIN_URL = process.env.GATE_DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/postgres';
const GATE_URL = (() => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${GATE_DB}`;
  return url.toString();
})();

// pg وابستگی apps/api است، نه ریشه — از همان‌جا بارگذاری می‌شود.
const { Client } = createRequire(join(API, 'package.json'))('pg');

const API_VITEST = 'pnpm --filter @gold/api exec vitest run';
const DB_ENV = { DATABASE_URL: GATE_URL };

function run(command, env = {}) {
  console.log(`$ ${command}`);
  const result = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}

async function admin(sql) {
  const client = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function filesImporting(directory, pattern, results = []) {
  if (!existsSync(directory)) return results;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(path).isDirectory()) filesImporting(path, pattern, results);
    else if (/\.(test|spec|e2e-spec)\.ts$/u.test(name) && pattern.test(readFileSync(path, 'utf8'))) results.push(path);
  }
  return results;
}

/** اسکیمای Drizzle با آخرین مهاجرت هم‌خوان است؛ مهاجرت روی دیتابیس خالی اعمال و تکرارش بی‌اثر است. */
async function migrations() {
  rmSync(DRIFT_DIR, { recursive: true, force: true });
  mkdirSync(DRIFT_DIR, { recursive: true });
  cpSync(join(API, 'drizzle'), DRIFT_DIR, { recursive: true });
  const sqlFiles = () => readdirSync(DRIFT_DIR).filter((name) => name.endsWith('.sql')).length;
  const before = sqlFiles();
  const out = relative(API, DRIFT_DIR).replace(/\\/g, '/');
  if (
    !run(
      `pnpm --filter @gold/api exec drizzle-kit generate --dialect=postgresql --casing=snake_case --schema=./src/platform/database/schema/index.ts --out=${out} --name=gate_drift_probe`,
    )
  ) {
    return false;
  }
  const created = sqlFiles() - before;
  rmSync(DRIFT_DIR, { recursive: true, force: true });
  if (created > 0) {
    console.error(
      '\napps/api/src/platform/database/schema [migration-drift] اسکیمای Drizzle با apps/api/drizzle هم‌خوان نیست — ' +
        'تغییر اسکیما بدون مهاجرت. اجرا کن: pnpm --filter @gold/api db:generate',
    );
    return false;
  }
  console.log('✓ اسکیما با آخرین مهاجرت هم‌خوان است.');

  await admin(`DROP DATABASE IF EXISTS ${GATE_DB} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${GATE_DB}`);
  console.log(`✓ دیتابیس تازه‌ی ${GATE_DB} ساخته شد.`);
  // بار دوم باید بی‌اثر باشد — مهاجرتی که دوباره اجرا شود یا journal ِ ناهم‌خوان اینجا می‌شکند.
  return run('pnpm --filter @gold/api db:migrate', DB_ENV) && run('pnpm --filter @gold/api db:migrate', DB_ENV);
}

/** آزمون‌های property-based (fast-check): ناوردای دفتر کل و موتور محاسبات. */
function property() {
  const core = filesImporting(join(ROOT, 'packages/core-calc/test'), /from 'fast-check'/u);
  const api = filesImporting(join(API, 'test'), /from 'fast-check'/u);
  const apiUnit = filesImporting(join(API, 'src'), /from 'fast-check'/u);
  if (core.length === 0 || api.length === 0) {
    console.error(
      'packages/core-calc/test · apps/api/test [property-tests-missing] آزمون property-based ِ موتور محاسبات یا ناوردای دفتر کل پیدا نشد (CLAUDE.md بخش ۷)',
    );
    return false;
  }
  const rel = (base, files) => files.map((file) => relative(base, file).replace(/\\/g, '/')).join(' ');
  return (
    run(`pnpm --filter @gold/core-calc exec vitest run ${rel(join(ROOT, 'packages/core-calc'), core)}`) &&
    (apiUnit.length === 0 || run(`${API_VITEST} ${rel(API, apiUnit)}`)) &&
    run(`${API_VITEST} --config vitest.config.e2e.mts ${rel(API, api)}`, DB_ENV)
  );
}

const STEPS = [
  { id: 'typescript', title: 'TypeScript (api، contracts، core-calc)', commands: ['pnpm --filter "@gold/api..." typecheck'] },
  {
    id: 'eslint',
    title: 'ESLint (api، core-calc، contracts، اسکریپت‌های دروازه)',
    commands: ['pnpm exec eslint apps/api packages/core-calc packages/contracts scripts/gate-backend.mjs scripts/check-backend-bans.mjs'],
  },
  {
    id: 'bans',
    title: 'ممنوعیت Math.round، any، ts-ignore، parseFloat، Number و پول/وزن با number',
    commands: ['node scripts/check-backend-bans.mjs'],
  },
  {
    id: 'idempotency',
    title: 'هر endpoint نوشتنی از Idempotency عبور می‌کند',
    commands: [`${API_VITEST} src/platform/idempotency/write-endpoints-idempotency.spec.ts`],
  },
  {
    id: 'unit',
    title: 'Unit tests (+ تازگی docs/openapi.json)',
    commands: ['pnpm --filter @gold/contracts test', 'pnpm --filter @gold/core-calc test', 'pnpm --filter @gold/api test'],
  },
  { id: 'coverage', title: 'پوشش ۱۰۰٪ core-calc', commands: ['pnpm --filter @gold/core-calc coverage'] },
  { id: 'migrations', title: `مهاجرت: هم‌خوانی اسکیما + اعمال روی ${GATE_DB} ِ خالی`, task: migrations },
  { id: 'property', title: 'Property-based tests (fast-check)', task: property },
  {
    id: 'integration',
    title: `Integration tests روی ${GATE_DB}`,
    commands: ['pnpm --filter @gold/api test:integration'],
    env: DB_ENV,
  },
  {
    id: 'invariants',
    title: 'ناورداهای دفتر کل، RLS و append-only روی داده‌ی همه‌ی آزمون‌ها',
    commands: ['node apps/api/scripts/verify-restore.mjs --out apps/api/.gate/invariants.json'],
    env: DB_ENV,
  },
  { id: 'build', title: 'Build (contracts، api)', commands: ['pnpm --filter @gold/contracts build', 'pnpm --filter @gold/api build'] },
];

const needsDatabase = new Set(['migrations', 'property', 'integration', 'invariants']);

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;
const keepDb = process.argv.includes('--keep-db');
if (only) {
  const unknown = [...only].filter((id) => !STEPS.some((step) => step.id === id));
  if (unknown.length > 0) {
    console.error(`مرحله‌ی ناشناخته: ${unknown.join(', ')} — مرحله‌ها: ${STEPS.map((step) => step.id).join(', ')}`);
    process.exit(2);
  }
  if ([...only].some((id) => needsDatabase.has(id) && id !== 'migrations') && !only.has('migrations')) {
    console.log(`(بدون مرحله‌ی migrations، از ${GATE_DB} ِ موجود استفاده می‌شود)`);
  }
}

mkdirSync(join(API, '.gate'), { recursive: true });
const formatSeconds = (ms) => `${(ms - (ms % 1000)) / 1000}s`;
const results = [];
let failed = false;
let createdDatabase = false;

try {
  for (const step of STEPS) {
    if (only && !only.has(step.id)) continue;
    if (failed) {
      results.push({ step, status: 'skipped' });
      continue;
    }
    console.log(`\n━━━ [${step.id}] ${step.title} ━━━`);
    const started = Date.now();
    let ok = true;
    try {
      if (step.task) {
        if (step.id === 'migrations') createdDatabase = true;
        ok = await step.task();
      } else {
        for (const command of step.commands) {
          if (!run(command, step.env)) {
            ok = false;
            break;
          }
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      ok = false;
    }
    results.push({ step, status: ok ? 'passed' : 'failed', ms: Date.now() - started });
    if (!ok) failed = true;
  }
} finally {
  if (createdDatabase && !keepDb) {
    await admin(`DROP DATABASE IF EXISTS ${GATE_DB} WITH (FORCE)`).catch((error) =>
      console.error(`حذف ${GATE_DB} ممکن نشد: ${error.message}`),
    );
  }
}

const MARK = { passed: '✓', failed: '✗', skipped: '·' };
console.log('\n━━━ نتیجه‌ی gate:backend ━━━');
for (const { step, status, ms } of results) {
  const time = ms === undefined ? 'اجرا نشد' : formatSeconds(ms);
  console.log(`${MARK[status]} ${step.id.padEnd(12)} ${time.padStart(8)}  ${step.title}`);
}
if (only) console.log('(فقط مرحله‌های --only اجرا شد — این دروازه‌ی کامل نیست)');

if (failed) {
  const broken = results.find((result) => result.status === 'failed');
  console.error(
    `\n✗ دروازه‌ی بک‌اند قرمز است: «${broken.step.title}». تکرار همان مرحله: pnpm gate:backend --only=${broken.step.id}`,
  );
  process.exit(1);
}
console.log('\n✓ دروازه‌ی بک‌اند سبز است.');
