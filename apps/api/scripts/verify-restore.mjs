/**
 * بررسی سلامت یک دیتابیس بازیابی‌شده — BE-068.
 *
 *   DATABASE_URL=... node apps/api/scripts/verify-restore.mjs [--out FILE] [--compare FILE]
 *
 * دو کار می‌کند:
 *
 * ۱. **بررسی‌های مطلق** — چیزهایی که روی هر دیتابیس سالمی باید برقرار باشند،
 *    مستقل از اینکه backup از کجا آمده: ناوردای دفتر کل (مجموع صفر در هر بُعد
 *    برای هر تراکنش)، نسخه‌ی مهاجرت برابر با فایل‌های مخزن، بی‌شکاف بودن
 *    شماره‌ی فاکتور، منفی نبودن موجودی، RLS اجباری روی هر جدول مستأجردار،
 *    جداسازی واقعی مستأجرها با نقش `gold_app`، و فعال بودن triggerهای
 *    append-only. هر شکست یعنی exit code ۱.
 *
 * ۲. **اثر انگشت** — شمارش‌ها و hash مانده‌ها برای هر مستأجر. روی دیتابیس مبدأ
 *    با `--out` ذخیره می‌شود و روی دیتابیس بازیابی‌شده با `--compare` مقایسه؛
 *    هر اختلاف یعنی backup ناقص است.
 *
 * فقط می‌خواند. بررسی append-only داخل تراکنشی اجرا می‌شود که همیشه
 * ROLLBACK می‌شود، پس حتی اگر trigger نبود هم چیزی تغییر نمی‌کرد.
 *
 * باید با کاربر مالک دیتابیس (superuser محیط Docker) اجرا شود: RLS برای
 * او اعمال نمی‌شود، پس شمارش‌ها کل داده را می‌بینند.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const JOURNAL_PATH = fileURLToPath(new URL('../drizzle/meta/_journal.json', import.meta.url));
const APP_ROLE = 'gold_app';
const TENANT_SETTING = 'app.current_tenant_id';
/** جدول‌هایی که triggerِ append-only شان با یک UPDATE/DELETE واقعی آزموده می‌شود. */
const APPEND_ONLY_PROBES = ['ledger_entries', 'ledger_transactions', 'inventory_movements', 'audit_logs'];

function parseArgs(argv) {
  const args = { out: undefined, compare: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--out' || flag === '--compare') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${flag} به مسیر فایل نیاز دارد`);
      }
      args[flag.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`آرگومان ناشناخته: ${flag}`);
    }
  }
  return args;
}

/**
 * گزارش مبدأ را می‌خواند، حتی اگر با PowerShell 5.1 ذخیره شده باشد: `>` آنجا
 * UTF-16 می‌نویسد و `Out-File -Encoding utf8` یک BOM جلویش می‌گذارد. هر دو
 * بدون این، JSON.parse را با پیامی گمراه‌کننده می‌شکنند.
 */
async function readJsonFile(path) {
  const bytes = await readFile(path);
  const text =
    bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

async function rows(client, text, values = []) {
  return (await client.query(text, values)).rows;
}

async function checkMigrations(client) {
  const journal = JSON.parse(await readFile(JOURNAL_PATH, 'utf8'));
  const expected = journal.entries.map((entry) => ({ tag: entry.tag, when: String(entry.when) }));
  const applied = await rows(
    client,
    'SELECT created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  const appliedWhen = new Set(applied.map((row) => row.when));
  const missing = expected.filter((entry) => !appliedWhen.has(entry.when)).map((entry) => entry.tag);

  return {
    summary: {
      applied: applied.length,
      expected: expected.length,
      latest: expected.at(-1)?.tag ?? null,
    },
    violations: [
      ...missing.map((tag) => `migration not applied: ${tag}`),
      ...(applied.length > expected.length
        ? [`database has ${applied.length - expected.length} migration(s) unknown to this checkout`]
        : []),
    ],
  };
}

async function checkLedgerInvariant(client) {
  const unbalanced = await rows(
    client,
    `SELECT e.tenant_id::text, e.transaction_id::text, e.dimension_id::text, sum(e.quantity)::text AS total
     FROM ledger_entries e
     GROUP BY e.tenant_id, e.transaction_id, e.dimension_id
     HAVING sum(e.quantity) <> 0
     ORDER BY 1, 2, 3
     LIMIT 20`,
  );
  const crossTenant = await rows(
    client,
    `SELECT e.id::text FROM ledger_entries e
     JOIN ledger_transactions t ON t.id = e.transaction_id
     WHERE t.tenant_id <> e.tenant_id
     LIMIT 20`,
  );
  const empty = await rows(
    client,
    `SELECT t.id::text FROM ledger_transactions t
     WHERE NOT EXISTS (SELECT 1 FROM ledger_entries e
                       WHERE e.tenant_id = t.tenant_id AND e.transaction_id = t.id)
     LIMIT 20`,
  );

  return [
    ...unbalanced.map(
      (row) => `ledger unbalanced: tx ${row.transaction_id} dimension ${row.dimension_id} sums to ${row.total}`,
    ),
    ...crossTenant.map((row) => `ledger entry ${row.id} belongs to another tenant's transaction`),
    ...empty.map((row) => `ledger transaction ${row.id} has no entries`),
  ];
}

async function checkDocuments(client) {
  const gaps = await rows(
    client,
    `SELECT c.tenant_id::text, c.period_key, n::text
     FROM document_counters c, generate_series(1, c.current_value) AS n
     WHERE c.document_type = 'SALES_INVOICE'
       AND NOT EXISTS (SELECT 1 FROM sales_invoices s
                       WHERE s.tenant_id = c.tenant_id AND s.invoice_number = n)
     ORDER BY 1, 2, 3
     LIMIT 20`,
  );
  const negativeStock = await rows(
    client,
    `SELECT tenant_id::text, item_type::text, item_id::text, sum(quantity)::text AS balance
     FROM inventory_movements
     GROUP BY tenant_id, item_type, item_id
     HAVING sum(quantity) < 0
     LIMIT 20`,
  );

  return [
    ...gaps.map((row) => `invoice number gap: tenant ${row.tenant_id} period ${row.period_key} number ${row.n}`),
    ...negativeStock.map(
      (row) => `negative stock: tenant ${row.tenant_id} ${row.item_type} ${row.item_id} = ${row.balance}`,
    ),
  ];
}

async function tenantTables(client) {
  return rows(
    client,
    `SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS app_access
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     ORDER BY c.relname`,
    [APP_ROLE],
  );
}

/**
 * جداسازی را با همان مسیری می‌آزماید که برنامه در هر درخواست طی می‌کند:
 * `SET LOCAL ROLE gold_app` و `set_config` مستأجر. روی هر جدول مستأجردار، هیچ
 * ردیفی از مستأجر دیگر نباید دیده شود و همه‌ی ردیف‌های خود مستأجر باید دیده شوند.
 */
async function checkIsolation(client, tables, tenantIds) {
  const violations = [];
  const membership = await rows(client, 'SELECT pg_has_role(current_user, $1, $2) AS member', [
    APP_ROLE,
    'MEMBER',
  ]).catch(() => [{ member: false }]);

  if (membership[0]?.member !== true) {
    return [`current user is not a member of ${APP_ROLE} — the API cannot SET ROLE after this restore`];
  }

  /*
   * جدول مستأجرداری که نقش برنامه هیچ دسترسی‌ای به آن ندارد (مثل `refresh_tokens`
   * از BE-065) RLS لازم ندارد: از مسیر درخواست اصلاً خواندنی نیست.
   */
  for (const table of tables) {
    if (table.app_access && (!table.rls || !table.forced)) {
      violations.push(`table ${table.name} has tenant_id but RLS is not enabled and forced`);
    }
  }

  for (const tenantId of tenantIds) {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
      for (const table of tables) {
        await client.query('SAVEPOINT probe');
        try {
          const [visible] = await rows(
            client,
            `SELECT count(*) FILTER (WHERE tenant_id <> $1)::text AS foreign,
                    count(*) FILTER (WHERE tenant_id = $1)::text AS own
             FROM ${client.escapeIdentifier(table.name)}`,
            [tenantId],
          );
          if (visible.foreign !== '0') {
            violations.push(`tenant ${tenantId} sees ${visible.foreign} foreign row(s) in ${table.name}`);
          }
          table.ownCounts ??= new Map();
          table.ownCounts.set(tenantId, visible.own);
          await client.query('RELEASE SAVEPOINT probe');
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT probe');
          // نقش برنامه عمداً به بعضی جدول‌ها دسترسی ندارد (BE-065)؛ ندیدن یعنی نشت هم نیست.
          if (error?.code !== '42501') {
            throw error;
          }
        }
      }
    } finally {
      await client.query('ROLLBACK');
    }

    for (const table of tables) {
      const own = table.ownCounts?.get(tenantId);
      if (own === undefined) {
        continue;
      }
      const [actual] = await rows(
        client,
        `SELECT count(*)::text AS count FROM ${client.escapeIdentifier(table.name)} WHERE tenant_id = $1`,
        [tenantId],
      );
      if (actual.count !== own) {
        violations.push(`tenant ${tenantId} sees ${own}/${actual.count} of its own rows in ${table.name}`);
      }
    }
  }

  return violations;
}

/** trigger غیرفعال در dump به‌صورت `DISABLE TRIGGER` بازمی‌گردد و بی‌صدا محافظت را برمی‌دارد. */
async function checkAppendOnly(client) {
  const violations = [];
  const disabled = await rows(
    client,
    `SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND t.tgenabled = 'D'`,
  );
  violations.push(...disabled.map((row) => `trigger ${row.tgname} on ${row.relname} is disabled`));

  for (const table of APPEND_ONLY_PROBES) {
    const [sample] = await rows(client, `SELECT id::text FROM ${client.escapeIdentifier(table)} LIMIT 1`);
    if (sample === undefined) {
      continue;
    }
    for (const statement of [
      `UPDATE ${client.escapeIdentifier(table)} SET created_at = created_at WHERE id = $1`,
      `DELETE FROM ${client.escapeIdentifier(table)} WHERE id = $1`,
    ]) {
      await client.query('BEGIN');
      try {
        await client.query(statement, [sample.id]);
        violations.push(`${statement.split(' ')[0]} on ${table} was accepted — append-only trigger missing`);
      } catch {
        // انتظار همین است: trigger رد کرد.
      } finally {
        await client.query('ROLLBACK');
      }
    }
  }

  return violations;
}

async function fingerprint(client) {
  const tenants = await rows(
    client,
    `SELECT t.id::text, t.slug,
       (SELECT count(*) FROM parties p WHERE p.tenant_id = t.id)::text AS parties,
       (SELECT count(*) FROM sales_invoices s WHERE s.tenant_id = t.id)::text AS invoices,
       (SELECT count(*) FROM sales_invoices s WHERE s.tenant_id = t.id AND s.status = 'FINALIZED')::text AS finalized_invoices,
       (SELECT coalesce(max(s.invoice_number), 0) FROM sales_invoices s WHERE s.tenant_id = t.id)::text AS max_invoice_number,
       (SELECT count(*) FROM second_hand_purchases p WHERE p.tenant_id = t.id)::text AS second_hand_purchases,
       (SELECT count(*) FROM settlements s WHERE s.tenant_id = t.id)::text AS settlements,
       (SELECT count(*) FROM ledger_transactions l WHERE l.tenant_id = t.id)::text AS ledger_transactions,
       (SELECT count(*) FROM ledger_entries e WHERE e.tenant_id = t.id)::text AS ledger_entries,
       (SELECT count(*) FROM inventory_movements m WHERE m.tenant_id = t.id)::text AS inventory_movements,
       (SELECT count(*) FROM audit_logs a WHERE a.tenant_id = t.id)::text AS audit_logs,
       (SELECT md5(coalesce(string_agg(b.line, ';' ORDER BY b.line), ''))
        FROM (SELECT e.account_id::text || ':' || e.dimension_id::text || '=' || sum(e.quantity)::text AS line
              FROM ledger_entries e WHERE e.tenant_id = t.id
              GROUP BY e.account_id, e.dimension_id) b) AS ledger_balances_md5,
       (SELECT md5(coalesce(string_agg(b.line, ';' ORDER BY b.line), ''))
        FROM (SELECT m.item_type::text || ':' || m.item_id::text || '=' || sum(m.quantity)::text AS line
              FROM inventory_movements m WHERE m.tenant_id = t.id
              GROUP BY m.item_type, m.item_id) b) AS inventory_balances_md5
     FROM tenants t
     ORDER BY t.id`,
  );
  const [schema] = await rows(
    client,
    `SELECT
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal)::text AS triggers,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::text AS policies,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')::text AS indexes,
       (SELECT count(*) FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY')::text AS foreign_keys`,
  );

  return { schema, tenants };
}

function compareFingerprints(expected, actual) {
  const differences = [];
  const walk = (path, left, right) => {
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        walk(`${path}.${key}`, left[key], right[key]);
      }
      return;
    }
    if (left !== right) {
      differences.push(`${path}: backup ${JSON.stringify(left)} ≠ restored ${JSON.stringify(right)}`);
    }
  };
  walk('fingerprint', expected, actual);
  return differences;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL تنظیم نشده.');
    process.exit(2);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const [{ database }] = await rows(client, 'SELECT current_database() AS database');
    const migrations = await checkMigrations(client);
    const tables = await tenantTables(client);
    const print = await fingerprint(client);
    const checks = {
      migrations: migrations.violations,
      ledgerInvariant: await checkLedgerInvariant(client),
      documentsAndStock: await checkDocuments(client),
      tenantIsolation: await checkIsolation(
        client,
        tables,
        print.tenants.map((tenant) => tenant.id),
      ),
      appendOnly: await checkAppendOnly(client),
    };

    let comparison;
    if (args.compare !== undefined) {
      const expected = await readJsonFile(args.compare);
      comparison = compareFingerprints(expected.fingerprint, print);
    }

    const failed = Object.values(checks).some((list) => list.length > 0) || (comparison?.length ?? 0) > 0;
    const report = {
      database,
      ok: !failed,
      migrations: migrations.summary,
      tenantTables: tables.length,
      checks,
      ...(comparison === undefined ? {} : { comparison }),
      fingerprint: print,
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out !== undefined) {
      await writeFile(args.out, json, 'utf8');
    }
    process.stdout.write(json);
    console.error(failed ? '✘ بررسی شکست خورد — بخش checks/comparison را ببین.' : '✔ همه‌ی بررسی‌ها سالم است.');
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('✘ اجرای بررسی شکست خورد:', error instanceof Error ? error.message : error);
  process.exit(2);
});
