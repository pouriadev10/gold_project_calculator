import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { JewelryItemsService } from '../../src/modules/inventory/jewelry-items.service';
import { OpeningBalancesService } from '../../src/modules/inventory/opening-balances.service';
import { PriceQuotesService } from '../../src/modules/pricing/price-quotes.service';
import { PasswordService } from '../../src/platform/auth/password.service';
import { DRIZZLE } from '../../src/platform/database/database.module';
import {
  APP_DATABASE_ROLE,
  TENANT_SETTING,
  withTenantTransaction,
} from '../../src/platform/database/tenant-transaction';
import { IDEMPOTENCY_KEY_HEADER } from '../../src/platform/idempotency/idempotency-key';
import { TenantService } from '../../src/platform/tenant/tenant.service';
import { MembershipService } from '../../src/platform/users/membership.service';
import { UserService } from '../../src/platform/users/user.service';
import {
  installQueryRecorder,
  isInfrastructureQuery,
  recordQueries,
  type RecordedQuery,
} from './query-recorder';
import type { Database } from '../../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Performance baseline — BE-066.
 *
 * Not part of `pnpm test` or `test:integration`: it seeds about a year of a
 * retail shop's documents and takes minutes. Run it against its own database:
 *
 *   DATABASE_URL=postgresql://gold:gold@localhost:5432/gold_bench pnpm --filter @gold/api bench:baseline
 *
 * Knobs: BENCH_SCALE_PERCENT (default 100), BENCH_SAMPLES (30), BENCH_CONCURRENCY (6).
 *
 * Everything goes through the real HTTP stack (auth, idempotency, RLS role).
 * For every measured request the statements are recorded; their count is the
 * N+1 check, and every SELECT is replayed with EXPLAIN ANALYZE as `gold_app`
 * under the same tenant so the plan is the one production would get.
 * Results: `apps/api/.bench/performance-baseline.{json,md}`.
 */

const PASSWORD = 'performance-baseline-password-1';
/*
 * Integers only: this repo bans Number()/Math.round/toFixed everywhere (money
 * rules), so the knobs are whole numbers — scale is a percentage.
 */
const SCALE_PERCENT = parseInt(process.env['BENCH_SCALE_PERCENT'] ?? '100', 10);
const SAMPLES = parseInt(process.env['BENCH_SAMPLES'] ?? '30', 10);
const WARMUP = 5;
const CONCURRENCY = parseInt(process.env['BENCH_CONCURRENCY'] ?? '6', 10);
/** A sequential scan touching at least this many rows is reported. */
const LARGE_SCAN_ROWS = 1_000;
const SLOW_STATEMENT_MS = 20;
const OUTPUT_DIR = join(__dirname, '..', '..', '.bench');

type Volume = {
  readonly parties: number;
  readonly cashJewelrySales: number;
  readonly creditJewelrySales: number;
  readonly coinSales: number;
  readonly rialSettlements: number;
  readonly mixedSettlements: number;
  readonly goldPurchases: number;
};

/** Roughly one year of a phase-1 retail shop (≈ 8 documents per working day). */
const MAIN_VOLUME: Volume = scaled({
  parties: 300,
  cashJewelrySales: 600,
  creditJewelrySales: 400,
  coinSales: 700,
  rialSettlements: 300,
  mixedSettlements: 100,
  goldPurchases: 200,
});
/** A second tenant, so every index is exercised with other tenants' rows present. */
const NOISE_VOLUME: Volume = scaled({
  parties: 150,
  cashJewelrySales: 300,
  creditJewelrySales: 200,
  coinSales: 350,
  rialSettlements: 150,
  mixedSettlements: 50,
  goldPurchases: 100,
});
/** Every n-th credit sale and settlement goes to one heavy customer (a quarter). */
const WHALE_EVERY = 4;

/** Integer division rounding down, for non-negative integers. */
function divideDown(value: number, divisor: number): number {
  return (value - (value % divisor)) / divisor;
}

const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, useGrouping: false });

/** Display form of a duration or size; the report is read by people, not code. */
function display(value: number): string {
  return oneDecimal.format(value);
}

function scaled(volume: Volume): Volume {
  const scale = (value: number) => Math.max(1, divideDown(value * SCALE_PERCENT, 100));
  return {
    parties: scale(volume.parties),
    cashJewelrySales: scale(volume.cashJewelrySales),
    creditJewelrySales: scale(volume.creditJewelrySales),
    coinSales: scale(volume.coinSales),
    rialSettlements: scale(volume.rialSettlements),
    mixedSettlements: scale(volume.mixedSettlements),
    goldPurchases: scale(volume.goldPurchases),
  };
}

type TenantSeed = {
  readonly id: string;
  readonly token: string;
  readonly quoteId: string;
  readonly coinTypeId: string;
  readonly partyIds: readonly string[];
  readonly whalePartyId: string;
  readonly lightPartyId: string;
  /** Stocked jewelry items not yet sold, consumed by seeding and measurement. */
  readonly freeItems: string[];
};

type HttpResult = { readonly statusCode: number; readonly body: string };

type PlanNode = {
  readonly 'Node Type': string;
  readonly 'Relation Name'?: string;
  readonly 'Index Name'?: string;
  readonly 'Actual Rows'?: number;
  readonly 'Actual Loops'?: number;
  readonly 'Rows Removed by Filter'?: number;
  readonly Plans?: readonly PlanNode[];
};

type StatementPlan = {
  readonly sql: string;
  readonly executionMs: number;
  readonly largeSeqScans: readonly string[];
  /** Relations still scanned sequentially with seq scans disabled: no usable index. */
  readonly noIndexPath: readonly string[];
  /** Indexes the planner uses for the flagged statement once seq scans are off. */
  readonly forcedIndexes: readonly string[];
  readonly indexes: readonly string[];
  /** Full plan, kept only for statements the review flags. */
  readonly plan?: PlanNode;
};

type ScenarioResult = {
  readonly name: string;
  readonly kind: 'write' | 'read';
  readonly samples: number;
  readonly p50Ms: string;
  readonly p95Ms: string;
  readonly maxMs: string;
  readonly totalQueries: number;
  readonly domainQueries: number;
  readonly plans: readonly StatementPlan[];
};

type NPlusOneCheck = {
  readonly name: string;
  readonly lightQueries: number;
  readonly heavyQueries: number;
  readonly lightRows: number;
  readonly heavyRows: number;
};

/** Nearest-rank percentile: the smallest sample with at least `percent`% of samples at or below it. */
function percentile(sorted: readonly number[], percent: number): number {
  const rank = divideDown(percent * sorted.length + 99, 100);
  return sorted[Math.max(0, rank - 1)]!;
}

function collectPlan(node: PlanNode, scans: string[], indexes: string[]): void {
  if (node['Node Type'] === 'Seq Scan') {
    const loops = node['Actual Loops'] ?? 1;
    const touched = ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * loops;
    if (touched >= LARGE_SCAN_ROWS) {
      scans.push(`${node['Relation Name'] ?? '?'} (${touched} rows)`);
    }
  }
  if (node['Index Name'] !== undefined) {
    indexes.push(node['Index Name']);
  }
  for (const child of node.Plans ?? []) {
    collectPlan(child, scans, indexes);
  }
}

function seqScannedRelations(node: PlanNode): string[] {
  const own = node['Node Type'] === 'Seq Scan' && node['Relation Name'] !== undefined ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScannedRelations)];
}

async function runPool(tasks: readonly (() => Promise<void>)[], concurrency: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task!();
    }
  });
  await Promise.all(workers);
}

describe('Performance baseline (BE-066)', () => {
  const adapter = new FastifyAdapter();
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  let app: NestFastifyApplication;
  let db: Database;
  let main: TenantSeed;
  let seedSeconds = '';
  const scenarios: ScenarioResult[] = [];
  const nPlusOne: NPlusOneCheck[] = [];

  async function http(
    tenant: TenantSeed,
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ): Promise<HttpResult> {
    const response = await adapter.getInstance().inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      headers: {
        authorization: `Bearer ${tenant.token}`,
        'x-tenant-id': tenant.id,
        [IDEMPOTENCY_KEY_HEADER]: randomUUID(),
      },
    });
    return { statusCode: response.statusCode, body: response.body };
  }

  async function expectOk(result: Promise<HttpResult>, label: string): Promise<HttpResult> {
    const settled = await result;
    if (settled.statusCode >= 300) {
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT pid, state, wait_event_type, wait_event, round(extract(epoch FROM now() - xact_start)::numeric, 2) AS xact_s,
                left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS query
         FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
      throw new Error(
        `${label} failed with ${settled.statusCode}: ${settled.body.slice(0, 300)}\n${JSON.stringify(rows, null, 1)}`,
      );
    }
    return settled;
  }

  function takeItem(tenant: TenantSeed): string {
    const item = tenant.freeItems.pop();
    if (item === undefined) throw new Error('ran out of stocked jewelry items');
    return item;
  }

  const now = () => new Date().toISOString();
  const cashSale = (tenant: TenantSeed, partyId: string) => ({
    partyId,
    jewelryItemId: takeItem(tenant),
    quoteId: tenant.quoteId,
    effectiveAt: now(),
  });
  const creditSale = (tenant: TenantSeed, partyId: string) => ({ ...cashSale(tenant, partyId), paidRial: '0' });
  const coinSale = (tenant: TenantSeed, partyId: string) => ({
    partyId,
    coinTypeId: tenant.coinTypeId,
    count: 1,
    marketUnitPriceRial: '900000000',
    quoteId: tenant.quoteId,
    effectiveAt: now(),
    paidRial: '900000000',
  });
  const rialSettlement = () => ({ amountRial: '1000000', effectiveAt: now() });
  const mixedSettlement = (tenant: TenantSeed) => ({
    lines: [
      { type: 'RIAL', amountRial: '1000000' },
      { type: 'GOLD', grossWeightMg: '1000', karat: 750, quoteId: tenant.quoteId },
    ],
    effectiveAt: now(),
  });
  const goldPurchase = (tenant: TenantSeed, partyId: string) => ({
    partyId,
    grossWeightMg: '5000',
    quoteId: tenant.quoteId,
    effectiveAt: now(),
  });

  async function createTenant(label: string, volume: Volume, extraItems: number): Promise<TenantSeed> {
    const tenant = await app.get(TenantService).create({
      name: label,
      slug: `bench-${randomUUID().slice(0, 12)}`,
    });
    const users = app.get(UserService);
    const owner = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: `${label} owner`,
    });
    await users.setPasswordHash(owner.id, await app.get(PasswordService).hash(PASSWORD));
    await app.get(MembershipService).add(tenant.id, { userId: owner.id, roleCode: 'OWNER' });
    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: owner.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    const token = login.json<{ accessToken: string }>().accessToken;
    const quoteId = (
      await app.get(PriceQuotesService).createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: owner.id,
      })
    ).id;
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM coin_types WHERE tenant_id = $1 AND code = 'BAHAR_AZADI_NEW'`,
      [tenant.id],
    );
    const coinTypeId = rows[0]!.id;

    // After the tenant exists: its seeded coin type versions start at creation time.
    const validFrom = new Date();
    // +1: the light party's single sale.
    const itemCount = volume.cashJewelrySales + volume.creditJewelrySales + extraItems + 1;
    const items: string[] = [];
    const jewelry = app.get(JewelryItemsService);
    await runPool(
      Array.from({ length: itemCount }, (_, index) => async () => {
        const created = await jewelry.createItem({
          tenantId: tenant.id,
          code: `BENCH-${index}-${randomUUID().slice(0, 6)}`,
          title: `انگشتر ${index}`,
          grossWeightMg: BigInt(6_000 + (index % 20) * 250),
          karat: 750,
          stoneWeightMg: 0n,
          otherDeductionWeightMg: 0n,
          wageType: 'PER_GRAM',
          wageValue: 300_000n,
          validFrom,
          active: true,
        });
        items.push(created.jewelryItemId);
      }),
      CONCURRENCY,
    );
    const opening = app.get(OpeningBalancesService);
    for (let start = 0; start < items.length; start += 499) {
      const chunk = items.slice(start, start + 499);
      await withTenantTransaction(db, tenant.id, (transaction) =>
        opening.createInTransaction(transaction, {
          tenantId: tenant.id,
          effectiveAt: validFrom,
          description: 'موجودی افتتاحیه‌ی benchmark',
          createdBy: owner.id,
          lines: [
            ...chunk.map((itemId) => ({ itemType: 'JEWELRY' as const, itemId, quantity: 1n })),
            ...(start === 0 ? [{ itemType: 'COIN' as const, itemId: coinTypeId, quantity: 100_000n }] : []),
          ],
        }),
      );
    }

    const seed: TenantSeed = {
      id: tenant.id,
      token,
      quoteId,
      coinTypeId,
      partyIds: [],
      whalePartyId: '',
      lightPartyId: '',
      freeItems: items,
    };
    const partyIds: string[] = [];
    await runPool(
      Array.from({ length: volume.parties }, (_, index) => async () => {
        const created = await expectOk(
          http(seed, 'POST', '/parties', {
            // Phase 1 buys second-hand gold only from consumers.
            type: 'CONSUMER',
            displayName: `مشتری شماره ${index} ${randomUUID().slice(0, 4)}`,
            mobile: `0912${String(1_000_000 + index).slice(1)}`,
          }),
          'party',
        );
        partyIds.push(String((JSON.parse(created.body) as { id: string }).id));
      }),
      CONCURRENCY,
    );
    const whalePartyId = partyIds[0]!;
    const lightPartyId = partyIds[1]!;
    const regular = partyIds.slice(2);
    const pick = (index: number) => regular[index % regular.length]!;
    const creditParty = (index: number) => (index % WHALE_EVERY === 0 ? whalePartyId : pick(index));
    const full: TenantSeed = { ...seed, partyIds, whalePartyId, lightPartyId };

    // Credit sales first: settlements need receivables to settle against.
    await runPool(
      Array.from({ length: volume.creditJewelrySales }, (_, index) => () =>
        expectOk(http(full, 'POST', '/sales/invoices/jewelry/credit', creditSale(full, creditParty(index))), 'credit sale').then(
          () => undefined,
        ),
      ),
      CONCURRENCY,
    );
    // The light party gets exactly one document, for the N+1 comparison.
    await expectOk(http(full, 'POST', '/sales/invoices/jewelry/credit', creditSale(full, lightPartyId)), 'light sale');
    const tasks: (() => Promise<void>)[] = [];
    for (let index = 0; index < volume.cashJewelrySales; index += 1) {
      tasks.push(() => expectOk(http(full, 'POST', '/sales/invoices/jewelry', cashSale(full, pick(index))), 'cash sale').then(() => undefined));
    }
    for (let index = 0; index < volume.coinSales; index += 1) {
      tasks.push(() => expectOk(http(full, 'POST', '/sales/invoices/coins', coinSale(full, pick(index))), 'coin sale').then(() => undefined));
    }
    for (let index = 0; index < volume.rialSettlements; index += 1) {
      tasks.push(() =>
        expectOk(http(full, 'POST', `/parties/${creditParty(index)}/settlements/rial`, rialSettlement()), 'rial settlement').then(
          () => undefined,
        ),
      );
    }
    for (let index = 0; index < volume.mixedSettlements; index += 1) {
      tasks.push(() =>
        expectOk(http(full, 'POST', `/parties/${creditParty(index)}/settlements/mixed`, mixedSettlement(full)), 'mixed settlement').then(
          () => undefined,
        ),
      );
    }
    for (let index = 0; index < volume.goldPurchases; index += 1) {
      tasks.push(() => expectOk(http(full, 'POST', '/purchase/second-hand/gold', goldPurchase(full, pick(index))), 'purchase').then(() => undefined));
    }
    await runPool(tasks, CONCURRENCY);
    return full;
  }

  /**
   * Seeding happens in seconds, so every document is dated "now" and every
   * date filter ("today", a profit period) matches the whole tenant — the
   * planner then rightly prefers sequential scans and the plan review means
   * nothing. A real year spreads documents over 365 days, so each source
   * document gets one random day in the past year, and its ledger
   * transaction and inventory movements get the same day.
   *
   * Benchmark database only: the append-only triggers are switched off for
   * this one superuser transaction (`DISABLE TRIGGER USER` keeps FKs on).
   */
  async function spreadDocumentDates(): Promise<void> {
    const guarded = [
      'sales_invoices',
      'sales_invoice_versions',
      'ledger_transactions',
      'inventory_movements',
      'settlements',
      'second_hand_purchases',
      'opening_balances',
    ];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of guarded) {
        await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await client.query(
        `CREATE TEMP TABLE document_dates ON COMMIT DROP AS
           SELECT id, now() - random() * interval '365 days' AS at FROM sales_invoices
           UNION ALL SELECT id, now() - random() * interval '365 days' FROM settlements
           UNION ALL SELECT id, now() - random() * interval '365 days' FROM second_hand_purchases
           UNION ALL SELECT id, now() - interval '400 days' FROM opening_balances`,
      );
      await client.query(
        `UPDATE sales_invoices s SET finalized_at = d.at, quote_observed_at = d.at, created_at = d.at
         FROM document_dates d WHERE d.id = s.id`,
      );
      await client.query(
        `UPDATE sales_invoice_versions v SET created_at = d.at FROM document_dates d WHERE d.id = v.sales_invoice_id`,
      );
      await client.query(
        `UPDATE settlements s SET effective_at = d.at, finalized_at = d.at, created_at = d.at
         FROM document_dates d WHERE d.id = s.id`,
      );
      await client.query(
        `UPDATE second_hand_purchases p SET effective_at = d.at, finalized_at = d.at, created_at = d.at
         FROM document_dates d WHERE d.id = p.id`,
      );
      await client.query(
        `UPDATE opening_balances o SET effective_at = d.at, created_at = d.at FROM document_dates d WHERE d.id = o.id`,
      );
      await client.query(
        `UPDATE ledger_transactions t SET effective_at = d.at, created_at = d.at
         FROM document_dates d WHERE d.id = t.source_id`,
      );
      await client.query(
        `UPDATE inventory_movements m SET occurred_at = d.at, created_at = d.at
         FROM document_dates d WHERE d.id = m.source_id`,
      );
      for (const table of guarded) {
        await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Replays every SELECT under the role it really ran with; always rolled back. */
  async function explain(queries: readonly RecordedQuery[], tenantId: string): Promise<StatementPlan[]> {
    const plans: StatementPlan[] = [];
    const client = await pool.connect();
    try {
      for (const query of queries) {
        const normalized = query.text.trim().toLowerCase();
        if (isInfrastructureQuery(query.text) || !(normalized.startsWith('select') || normalized.startsWith('with'))) {
          continue;
        }
        await client.query('BEGIN');
        if (query.appRole) {
          await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
          await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
        }
        const { rows } = await client.query<{ 'QUERY PLAN': { Plan: PlanNode; 'Execution Time': number }[] }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`,
          [...query.values],
        );
        await client.query('ROLLBACK');
        const [result] = rows[0]!['QUERY PLAN'];
        const scans: string[] = [];
        const indexes: string[] = [];
        collectPlan(result!.Plan, scans, indexes);

        /*
         * With two tenants, `tenant_id = $1` matches most of every table and a
         * seq scan is the right choice here — on a server with many tenants it
         * is not. Forbidding seq scans shows whether an index path exists at
         * all: a relation still scanned sequentially has no usable index.
         */
        const noIndexPath: string[] = [];
        const forcedIndexes: string[] = [];
        if (scans.length > 0) {
          await client.query('BEGIN');
          if (query.appRole) {
            await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
            await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
          }
          await client.query('SET LOCAL enable_seqscan = off');
          const forced = await client.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
            `EXPLAIN (FORMAT JSON) ${query.text}`,
            [...query.values],
          );
          await client.query('ROLLBACK');
          const flagged = new Set(scans.map((scan) => scan.split(' ')[0]!));
          const forcedPlan = forced.rows[0]!['QUERY PLAN'][0]!.Plan;
          for (const relation of seqScannedRelations(forcedPlan)) {
            if (flagged.has(relation)) noIndexPath.push(relation);
          }
          collectPlan(forcedPlan, [], forcedIndexes);
        }

        plans.push({
          sql: query.text.replace(/\s+/g, ' ').slice(0, 220),
          executionMs: result!['Execution Time'],
          largeSeqScans: scans,
          noIndexPath: [...new Set(noIndexPath)],
          forcedIndexes: [...new Set(forcedIndexes)],
          indexes: [...new Set(indexes)],
          ...(scans.length > 0 || result!['Execution Time'] >= SLOW_STATEMENT_MS ? { plan: result!.Plan } : {}),
        });
      }
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    return plans;
  }

  async function measure(
    name: string,
    kind: 'write' | 'read',
    request: () => Promise<HttpResult>,
  ): Promise<ScenarioResult> {
    for (let index = 0; index < WARMUP; index += 1) {
      await expectOk(request(), `${name} warm-up`);
    }
    const timings: number[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now();
      await expectOk(request(), name);
      timings.push(performance.now() - started);
    }
    const recorded = await recordQueries(() => expectOk(request(), `${name} recorded`));
    const sorted = [...timings].sort((left, right) => left - right);
    const result: ScenarioResult = {
      name,
      kind,
      samples: SAMPLES,
      p50Ms: display(percentile(sorted, 50)),
      p95Ms: display(percentile(sorted, 95)),
      maxMs: display(sorted[sorted.length - 1]!),
      totalQueries: recorded.queries.length,
      domainQueries: recorded.queries.filter((query) => !isInfrastructureQuery(query.text)).length,
      plans: await explain(recorded.queries, main.id),
    };
    scenarios.push(result);
    return result;
  }

  async function domainQueries(
    request: () => Promise<HttpResult>,
  ): Promise<{ readonly texts: readonly string[]; readonly rows: number }> {
    const recorded = await recordQueries(() => expectOk(request(), 'n+1 probe'));
    const body = JSON.parse(recorded.result.body) as Record<string, unknown>;
    const items = body['items'] ?? body['entries'] ?? body['events'];
    return {
      texts: recorded.queries
        .filter((query) => !isInfrastructureQuery(query.text))
        .map((query) => query.text.replace(/\s+/g, ' ').slice(0, 160)),
      rows: Array.isArray(items) ? items.length : 0,
    };
  }

  beforeAll(async () => {
    if (process.env['DATABASE_URL'] === undefined || !process.env['DATABASE_URL'].includes('gold_bench')) {
      throw new Error('Run the benchmark against its own database: DATABASE_URL=.../gold_bench');
    }
    installQueryRecorder();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
    db = app.get<Database>(DRIZZLE);

    const started = performance.now();
    await createTenant('Benchmark noise tenant', NOISE_VOLUME, 0);
    main = await createTenant('Benchmark tenant', MAIN_VOLUME, 4 * (SAMPLES + WARMUP + 2));
    await spreadDocumentDates();
    seedSeconds = display((performance.now() - started) / 1000);
    // Production has autovacuum statistics; give the planner the same.
    await pool.query('ANALYZE');
  }, 3_600_000);

  afterAll(async () => {
    const { rows: volume } = await pool.query<{ table: string; rows: number }>(
      `SELECT relname AS "table", n_live_tup::int AS rows FROM pg_stat_user_tables
       WHERE n_live_tup > 0 ORDER BY n_live_tup DESC`,
    );
    const { rows: version } = await pool.query<{ version: string }>('SELECT version()');
    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        postgres: version[0]!.version,
        cpu: cpus()[0]?.model ?? 'unknown',
        cores: cpus().length,
        memoryGb: display(totalmem() / 1024 ** 3),
        scalePercent: SCALE_PERCENT,
        samples: SAMPLES,
        seedSeconds,
      },
      volume,
      scenarios,
      nPlusOne,
    };
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(join(OUTPUT_DIR, 'performance-baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
    const lines = [
      '| scenario | kind | p50 ms | p95 ms | max ms | queries (domain) |',
      '|---|---|---|---|---|---|',
      ...scenarios.map(
        (scenario) =>
          `| ${scenario.name} | ${scenario.kind} | ${scenario.p50Ms} | ${scenario.p95Ms} | ${scenario.maxMs} | ${scenario.totalQueries} (${scenario.domainQueries}) |`,
      ),
      '',
      '| N+1 probe | light: queries / rows | heavy: queries / rows |',
      '|---|---|---|',
      ...nPlusOne.map((check) => `| ${check.name} | ${check.lightQueries} / ${check.lightRows} | ${check.heavyQueries} / ${check.heavyRows} |`),
      '',
      '| scenario | statement | ms | large seq scans | no index path | indexes (with seq scans off) |',
      '|---|---|---|---|---|---|',
      ...scenarios.flatMap((scenario) =>
        scenario.plans
          .filter((plan) => plan.largeSeqScans.length > 0 || plan.executionMs >= SLOW_STATEMENT_MS)
          .map(
            (plan) =>
              `| ${scenario.name} | \`${plan.sql.slice(0, 120)}\` | ${display(plan.executionMs)} | ${plan.largeSeqScans.join(', ')} | ${plan.noIndexPath.join(', ')} | ${plan.indexes.join(', ')} (${plan.forcedIndexes.join(', ')}) |`,
          ),
      ),
    ];
    writeFileSync(join(OUTPUT_DIR, 'performance-baseline.md'), `${lines.join('\n')}\n`);
    await app.close();
    await pool.end();
  });

  it('writes: typical transaction registration', async () => {
    await measure('cash jewelry sale', 'write', () => http(main, 'POST', '/sales/invoices/jewelry', cashSale(main, main.lightPartyId)));
    await measure('credit jewelry sale', 'write', () =>
      http(main, 'POST', '/sales/invoices/jewelry/credit', creditSale(main, main.whalePartyId)),
    );
    await measure('coin sale', 'write', () => http(main, 'POST', '/sales/invoices/coins', coinSale(main, main.lightPartyId)));
    await measure('rial settlement', 'write', () =>
      http(main, 'POST', `/parties/${main.whalePartyId}/settlements/rial`, rialSettlement()),
    );
    await measure('mixed settlement', 'write', () =>
      http(main, 'POST', `/parties/${main.whalePartyId}/settlements/mixed`, mixedSettlement(main)),
    );
    await measure('second-hand gold purchase', 'write', () =>
      http(main, 'POST', '/purchase/second-hand/gold', goldPurchase(main, main.lightPartyId)),
    );
    expect(scenarios.filter((scenario) => scenario.kind === 'write')).toHaveLength(6);
  }, 3_600_000);

  it('reads: balances, dashboard, statement and hot lists', async () => {
    const quote = `referenceQuoteId=${main.quoteId}`;
    await measure('party balances (heavy party)', 'read', () =>
      http(main, 'GET', `/parties/${main.whalePartyId}/balances?${quote}`),
    );
    await measure('dashboard', 'read', () => http(main, 'GET', '/reporting/dashboard'));
    await measure('party statement (heavy party, 50 rows)', 'read', () =>
      http(main, 'GET', `/parties/${main.whalePartyId}/statement?limit=50&${quote}`),
    );
    await measure('debtors report (50 rows)', 'read', () => http(main, 'GET', `/reporting/debtors?limit=50&${quote}`));
    await measure('invoice list (50 rows)', 'read', () => http(main, 'GET', '/sales/invoices?limit=50'));
    await measure('party search', 'read', () =>
      http(main, 'GET', `/parties?search=${encodeURIComponent('مشتری شماره 12')}&limit=20`),
    );
    await measure('profit report (all time)', 'read', () => http(main, 'GET', '/reporting/profit'));
    // The usual use: one month, out of a year of history.
    const month = `from=${encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`;
    await measure('profit report (one month)', 'read', () => http(main, 'GET', `/reporting/profit?${month}`));
    await measure('invoice list (one month, 50 rows)', 'read', () =>
      http(main, 'GET', `/sales/invoices?limit=50&${month}`),
    );
    expect(scenarios.filter((scenario) => scenario.kind === 'read')).toHaveLength(9);
  }, 3_600_000);

  it('no N+1: query count does not grow with the data behind the request', async () => {
    const quote = `referenceQuoteId=${main.quoteId}`;
    /*
     * Same data, more rows: an N+1 shows up as more statements for 50 rows than
     * for 5. Balances has no page size, so a one-document party is compared with
     * the heavy one instead (both hold the same document kinds per row).
     */
    const probes: ReadonlyArray<readonly [string, () => Promise<HttpResult>, () => Promise<HttpResult>]> = [
      [
        'party statement (heavy party)',
        () => http(main, 'GET', `/parties/${main.whalePartyId}/statement?limit=5&${quote}`),
        () => http(main, 'GET', `/parties/${main.whalePartyId}/statement?limit=50&${quote}`),
      ],
      [
        'party balances (light vs heavy party)',
        () => http(main, 'GET', `/parties/${main.lightPartyId}/balances?${quote}`),
        () => http(main, 'GET', `/parties/${main.whalePartyId}/balances?${quote}`),
      ],
      ['invoice list', () => http(main, 'GET', '/sales/invoices?limit=5'), () => http(main, 'GET', '/sales/invoices?limit=50')],
      [
        'debtors report',
        () => http(main, 'GET', `/reporting/debtors?limit=5&${quote}`),
        () => http(main, 'GET', `/reporting/debtors?limit=50&${quote}`),
      ],
      ['party list', () => http(main, 'GET', '/parties?limit=5'), () => http(main, 'GET', '/parties?limit=50')],
    ];
    const mismatches: string[] = [];
    for (const [name, light, heavy] of probes) {
      const lightRun = await domainQueries(light);
      const heavyRun = await domainQueries(heavy);
      nPlusOne.push({
        name,
        lightQueries: lightRun.texts.length,
        heavyQueries: heavyRun.texts.length,
        lightRows: lightRun.rows,
        heavyRows: heavyRun.rows,
      });
      if (heavyRun.texts.length !== lightRun.texts.length) {
        mismatches.push(`${name}\n  light: ${lightRun.texts.join('\n         ')}\n  heavy: ${heavyRun.texts.join('\n         ')}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 3_600_000);
});
