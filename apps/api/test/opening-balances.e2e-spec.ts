import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  coinTypes,
  inventoryMovements,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  openingBalances,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import type { Database } from '../src/platform/database/connect';
import type { LedgerEntryMetadata, RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'opening-balance-password';
const BASE_PATH = '/inventory/opening-balances';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  id: string;
  token: string;
}

interface OpeningBalanceResponse {
  id: string;
  ledgerTransactionId: string;
  effectiveAt: string;
  description: string;
  createdAt: string;
}

interface InventoryBalanceResponse {
  itemType: 'JEWELRY' | 'MELTED_GOLD' | 'COIN';
  itemId: string | null;
  quantity: string;
}

function isMetadataRecord(
  metadata: LedgerEntryMetadata,
): metadata is { readonly [key: string]: LedgerEntryMetadata } {
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata);
}

function metadataHasItemType(metadata: LedgerEntryMetadata, itemType: string): boolean {
  return isMetadataRecord(metadata) && metadata['itemType'] === itemType;
}

function metadataHasKey(metadata: LedgerEntryMetadata, key: string): boolean {
  return isMetadataRecord(metadata) && key in metadata;
}

/** Opening inventory API — real PostgreSQL required. */
describe('opening inventory API (real PostgreSQL required)', () => {
  const adapter = new FastifyAdapter();
  const tenant: TenantFixture = { id: '', slug: `opening-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let passwords: PasswordService;
  let users: UserService;
  let memberships: MembershipService;
  let tenantService: TenantService;
  let jewelryItems: JewelryItemsService;
  let owner: Member;
  let manager: Member;
  let cashier: Member;
  let jewelryItemId = '';
  let coinTypeId = '';
  let effectiveAt = '';

  async function makeMember(roleCode: RoleCode): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: `opening ${roleCode}`,
    });
    await users.setPasswordHash(user.id, await passwords.hash(PASSWORD));
    await memberships.add(tenant.id, { userId: user.id, roleCode });

    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);
    return { id: user.id, token: login.json<{ accessToken: string }>().accessToken };
  }

  function headers(member: Member): Record<string, string> {
    return { authorization: `Bearer ${member.token}`, [TENANT_HEADER]: tenant.id };
  }

  function writeHeaders(member: Member, key = randomUUID()): Record<string, string> {
    return { ...headers(member), 'idempotency-key': key };
  }

  function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      effectiveAt,
      description: 'موجودی افتتاحیه',
      lines: [
        { itemType: 'JEWELRY', itemId: jewelryItemId, quantity: '2' },
        { itemType: 'MELTED_GOLD', quantity: '4300' },
        { itemType: 'COIN', itemId: coinTypeId, quantity: '3' },
      ],
      ...overrides,
    };
  }

  async function createOpening(member: Member, body = payload(), key = randomUUID()) {
    return adapter.getInstance().inject({
      method: 'POST',
      url: BASE_PATH,
      headers: writeHeaders(member, key),
      payload: body,
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    passwords = app.get(PasswordService);
    users = app.get(UserService);
    memberships = app.get(MembershipService);
    tenantService = app.get(TenantService);
    jewelryItems = app.get(JewelryItemsService);

    const created = await tenantService.create({
      name: 'opening balance tenant',
      slug: tenant.slug,
    });
    tenant.id = created.id;
    const openingTime = new Date();
    effectiveAt = openingTime.toISOString();
    owner = await makeMember('OWNER');
    manager = await makeMember('MANAGER');
    cashier = await makeMember('CASHIER');

    const jewelry = await jewelryItems.createItem({
      tenantId: tenant.id,
      code: `OPENING-${randomUUID().slice(0, 8)}`,
      title: 'انگشتر افتتاحیه',
      grossWeightMg: 12_000n,
      karat: 750,
      stoneWeightMg: 2_000n,
      otherDeductionWeightMg: 0n,
      wageType: 'PER_GRAM',
      wageValue: 0n,
      validFrom: new Date(openingTime.getTime() - 1_000),
      active: true,
    });
    jewelryItemId = jewelry.jewelryItemId;

    const [coin] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(coinTypes).where(eq(coinTypes.tenantId, tenant.id)).limit(1),
    );
    coinTypeId = coin!.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app?.close();
  });

  it('records jewelry, melted gold, and count-only coins with one source and matching ledger', async () => {
    const response = await createOpening(owner);
    expect(response.statusCode).toBe(201);
    const created = response.json<OpeningBalanceResponse>();

    const state = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [source] = await transaction
        .select()
        .from(openingBalances)
        .where(and(eq(openingBalances.tenantId, tenant.id), eq(openingBalances.id, created.id)));
      const movements = await transaction
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenant.id),
            eq(inventoryMovements.sourceType, 'OPENING_BALANCE'),
            eq(inventoryMovements.sourceId, created.id),
          ),
        );
      const [ledger] = await transaction
        .select()
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.id, created.ledgerTransactionId),
          ),
        );
      const entries = await transaction
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.tenantId, tenant.id),
            eq(ledgerEntries.transactionId, created.ledgerTransactionId),
          ),
        );

      return { source, movements, ledger, entries };
    });

    expect(state.source).toMatchObject({ id: created.id, description: 'موجودی افتتاحیه' });
    expect(state.movements).toHaveLength(3);
    expect(state.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemType: 'JEWELRY', itemId: jewelryItemId, quantity: 2n }),
        expect.objectContaining({ itemType: 'MELTED_GOLD', itemId: null, quantity: 4300n }),
        expect.objectContaining({ itemType: 'COIN', itemId: coinTypeId, quantity: 3n }),
      ]),
    );
    expect(state.ledger).toMatchObject({
      sourceType: 'OPENING_BALANCE',
      sourceId: created.id,
    });
    expect(state.entries).toHaveLength(6);

    const totals = new Map<string, bigint>();
    for (const entry of state.entries) {
      totals.set(entry.dimensionId, (totals.get(entry.dimensionId) ?? 0n) + entry.quantity);
    }
    expect([...totals.values()]).toEqual([0n, 0n]);

    const coinEntries = state.entries.filter((entry) =>
      metadataHasItemType(entry.metadata, 'COIN'),
    );
    expect(coinEntries.map((entry) => entry.quantity)).toEqual([3n, -3n]);
    expect(coinEntries.every((entry) => !metadataHasKey(entry.metadata, 'weightMg'))).toBe(true);
  });

  it('replays an idempotency key without doubling inventory or ledger rows', async () => {
    const key = randomUUID();
    const body = payload({ description: 'افتتاحیه قابل تکرار' });
    const first = await createOpening(manager, body, key);
    const replay = await createOpening(manager, body, key);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const firstBody = first.json<OpeningBalanceResponse>();
    expect(replay.json<OpeningBalanceResponse>().id).toBe(firstBody.id);

    const state = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const movements = await transaction
        .select({ id: inventoryMovements.id })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.sourceId, firstBody.id));
      const entries = await transaction
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, firstBody.ledgerTransactionId));
      return { movements, entries };
    });

    expect(state.movements).toHaveLength(3);
    expect(state.entries).toHaveLength(6);
  });

  it('exposes tenant balances as decimal strings', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/inventory/balances',
      headers: headers(owner),
    });

    expect(response.statusCode).toBe(200);
    const balances = response.json<InventoryBalanceResponse[]>();
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemType: 'JEWELRY', itemId: jewelryItemId, quantity: '4' }),
        expect.objectContaining({ itemType: 'MELTED_GOLD', itemId: null, quantity: '8600' }),
        expect.objectContaining({ itemType: 'COIN', itemId: coinTypeId, quantity: '6' }),
      ]),
    );
    expect(balances.every((balance) => typeof balance.quantity === 'string')).toBe(true);
  });

  it('rejects a cashier and requires an Idempotency-Key', async () => {
    const cashierResponse = await createOpening(cashier);
    expect(cashierResponse.statusCode).toBe(403);

    const missingKey = await adapter.getInstance().inject({
      method: 'POST',
      url: BASE_PATH,
      headers: headers(owner),
      payload: payload(),
    });
    expect(missingKey.statusCode).toBe(400);
  });

  it('rolls back a source and movements when the matching ledger cannot post', async () => {
    const [jewelryAccount] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenant.id),
            eq(ledgerAccounts.systemKey, 'INVENTORY_JEWELRY'),
          ),
        )
        .limit(1),
    );
    await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .update(ledgerAccounts)
        .set({ active: false })
        .where(eq(ledgerAccounts.id, jewelryAccount!.id)),
    );

    const before = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const sources = await transaction.select({ id: openingBalances.id }).from(openingBalances);
      const movements = await transaction
        .select({ id: inventoryMovements.id })
        .from(inventoryMovements);
      const ledgers = await transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions);
      return { sources: sources.length, movements: movements.length, ledgers: ledgers.length };
    });

    const response = await createOpening(owner, payload({ description: 'باید rollback شود' }));
    expect(response.statusCode).toBe(500);

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const sources = await transaction.select({ id: openingBalances.id }).from(openingBalances);
      const movements = await transaction
        .select({ id: inventoryMovements.id })
        .from(inventoryMovements);
      const ledgers = await transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions);
      return { sources: sources.length, movements: movements.length, ledgers: ledgers.length };
    });

    expect(after).toEqual(before);
  });
});
