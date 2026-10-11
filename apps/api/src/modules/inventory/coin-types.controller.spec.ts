import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { coinTypeCatalogSchema, coinTypeVersionSchema } from '@gold/contracts';
import { ROLES_METADATA_KEY } from '../../platform/auth/roles.decorator';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { CoinTypesController, toCoinTypeVersionResponse } from './coin-types.controller';
import {
  CoinMintTypeMismatchError,
  CoinTypeCodeConflictError,
  CoinTypeNotFoundError,
  InvalidCoinTypeVersionDateError,
} from './coin-types.errors';
import { groupCoinTypeHistory, type CoinTypesService } from './coin-types.service';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';
import type { CoinTypeVersion } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** FE-081 — API نازک انواع سکه روی `CoinTypesService` نسخه‌دار. */

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const USER = 'b0000000-0000-4000-8000-000000000001';
const COIN_TYPE = 'c0000000-0000-4000-8000-000000000001';
const OTHER_COIN_TYPE = 'c0000000-0000-4000-8000-000000000002';
const V1_FROM = new Date('2026-08-01T00:00:00.000Z');
const V2_FROM = new Date('2026-10-01T00:00:00.000Z');

function version(overrides: Partial<CoinTypeVersion> = {}): CoinTypeVersion {
  return {
    id: 'd0000000-0000-4000-8000-000000000001',
    tenantId: TENANT,
    coinTypeId: COIN_TYPE,
    title: 'ربع سکه بهار آزادی',
    mintType: 'CENTRAL_BANK',
    grossWeightUg: 2_033_200n,
    karat: 900,
    isCentralBankMinted: true,
    validFrom: V1_FROM,
    validTo: null,
    version: 1,
    active: true,
    createdAt: V1_FROM,
    ...overrides,
  };
}

const transaction = {} as TenantTransaction;
const context = { getTenantId: () => TENANT } as RequestContextService;
const auth = { sub: USER, tid: TENANT, role: 'MANAGER' as const };
const passThrough = {
  execute: vi.fn(async (input: { execute: (tx: TenantTransaction) => Promise<{ body: unknown }> }) => ({
    response: await input.execute(transaction),
  })),
} as unknown as IdempotencyService;

describe('toCoinTypeVersionResponse', () => {
  it('keeps the microgram weight as an exact string and satisfies the shared contract', () => {
    const response = toCoinTypeVersionResponse('ROB', version());
    expect(response.grossWeightUg).toBe('2033200');
    expect(coinTypeVersionSchema.parse(response)).toEqual(response);
  });

  it('only a CENTRAL_BANK version is bubble-eligible', () => {
    expect(toCoinTypeVersionResponse('ROB', version()).isCentralBankMinted).toBe(true);
    const privateMint = toCoinTypeVersionResponse(
      'PARSIAN',
      version({ mintType: 'PRIVATE_MINT', isCentralBankMinted: false }),
    );
    expect(privateMint).toMatchObject({ mintType: 'PRIVATE_MINT', isCentralBankMinted: false });
    expect(coinTypeVersionSchema.parse(privateMint)).toEqual(privateMint);
  });

  it('serializes a closed interval', () => {
    expect(toCoinTypeVersionResponse('ROB', version({ validTo: V2_FROM })).validTo).toBe(V2_FROM.toISOString());
  });
});

describe('groupCoinTypeHistory', () => {
  it('groups ordered rows into one record per type, keeping the newest-first order', () => {
    const v2 = version({ id: 'd0000000-0000-4000-8000-000000000002', version: 2, validFrom: V2_FROM });
    const v1 = version({ validTo: V2_FROM });
    const other = version({ id: 'd0000000-0000-4000-8000-000000000003', coinTypeId: OTHER_COIN_TYPE });

    const grouped = groupCoinTypeHistory([
      { code: 'ROB', version: v2 },
      { code: 'ROB', version: v1 },
      { code: 'GERAMI', version: other },
    ]);

    expect(grouped).toEqual([
      { coinTypeId: COIN_TYPE, code: 'ROB', versions: [v2, v1] },
      { coinTypeId: OTHER_COIN_TYPE, code: 'GERAMI', versions: [other] },
    ]);
  });
});

describe('CoinTypesController', () => {
  it('lets every role read but only OWNER and MANAGER create types or versions', () => {
    const roles = (method: keyof CoinTypesController) =>
      Reflect.getMetadata(ROLES_METADATA_KEY, CoinTypesController.prototype[method]) as unknown;
    expect(roles('list')).toEqual(['OWNER', 'MANAGER', 'CASHIER']);
    expect(roles('history')).toEqual(['OWNER', 'MANAGER', 'CASHIER']);
    expect(roles('create')).toEqual(['OWNER', 'MANAGER']);
    expect(roles('createVersion')).toEqual(['OWNER', 'MANAGER']);
  });

  it('lists the version effective right now for each type', async () => {
    const listEffective = vi.fn(async () => [{ code: 'ROB', version: version() }]);
    const controller = new CoinTypesController(context, passThrough, {
      listEffective,
    } as unknown as CoinTypesService);

    const before = Date.now();
    const result = await controller.list();

    expect(result.map((row) => row.code)).toEqual(['ROB']);
    const [tenant, at] = listEffective.mock.calls[0] as unknown as [string, Date];
    expect(tenant).toBe(TENANT);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns every type with its full history in the catalog contract', async () => {
    const controller = new CoinTypesController(context, passThrough, {
      listHistory: vi.fn(async () => [
        {
          coinTypeId: COIN_TYPE,
          code: 'ROB',
          versions: [version({ version: 2, validFrom: V2_FROM, active: false }), version({ validTo: V2_FROM })],
        },
      ]),
    } as unknown as CoinTypesService);

    const catalog = await controller.history();

    expect(coinTypeCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog.types[0]?.versions.map((v) => [v.version, v.active, v.validTo])).toEqual([
      [2, false, null],
      [1, true, V2_FROM.toISOString()],
    ]);
  });

  it('creates a type starting now, deriving bubble eligibility from the mint and recording the author', async () => {
    const createTypeInTransaction = vi.fn(async () => version({ mintType: 'OTHER', isCentralBankMinted: false }));
    const getCodeInTransaction = vi.fn(async () => 'NEW');
    const controller = new CoinTypesController(context, passThrough, {
      createTypeInTransaction,
      getCodeInTransaction,
    } as unknown as CoinTypesService);

    const before = Date.now();
    const result = await controller.create(
      { code: 'NEW', title: 'سکه پارسیان', mintType: 'OTHER', grossWeightUg: '1000000', karat: 750, active: true },
      auth,
      'key-1',
    );

    expect(result).toMatchObject({ code: 'NEW', isCentralBankMinted: false });
    const input = (createTypeInTransaction.mock.calls[0] as unknown as [TenantTransaction, Record<string, unknown>])[1];
    expect(input).toMatchObject({
      tenantId: TENANT,
      code: 'NEW',
      mintType: 'OTHER',
      isCentralBankMinted: false,
      grossWeightUg: 1_000_000n,
      karat: 750,
      active: true,
      actorUserId: USER,
    });
    expect((input['validFrom'] as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(passThrough.execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, key: 'key-1', request: expect.objectContaining({ path: '/inventory/coin-types' }) }),
    );
  });

  it('creates the next version of an existing type through the idempotency gate', async () => {
    const createVersionInTransaction = vi.fn(async () => version({ version: 2, validFrom: V2_FROM }));
    const controller = new CoinTypesController(context, passThrough, {
      createVersionInTransaction,
      getCodeInTransaction: vi.fn(async () => 'ROB'),
    } as unknown as CoinTypesService);

    const result = await controller.createVersion(
      COIN_TYPE,
      { title: 'ربع سکه', mintType: 'CENTRAL_BANK', grossWeightUg: '2033200', karat: 900, active: false },
      auth,
      'key-2',
    );

    expect(result).toMatchObject({ code: 'ROB', version: 2, isCentralBankMinted: true });
    expect(createVersionInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ coinTypeId: COIN_TYPE, isCentralBankMinted: true, active: false, actorUserId: USER }),
    );
    expect(passThrough.execute).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ path: `/inventory/coin-types/${COIN_TYPE}/versions` }) }),
    );
  });

  it('requires authentication and maps domain errors to 404/409/400', async () => {
    const failWith = (error: Error) =>
      new CoinTypesController(
        context,
        { execute: vi.fn(async () => Promise.reject(error)) } as unknown as IdempotencyService,
        {} as CoinTypesService,
      );
    const body = { title: 'ربع', mintType: 'CENTRAL_BANK' as const, grossWeightUg: '1', karat: 900, active: true };

    await expect(failWith(new Error('x')).createVersion(COIN_TYPE, body, undefined, 'k')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(failWith(new Error('x')).create({ code: 'X', ...body }, undefined, 'k')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      failWith(new CoinTypeNotFoundError(COIN_TYPE)).createVersion(COIN_TYPE, body, auth, 'k'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(failWith(new CoinTypeCodeConflictError('X')).create({ code: 'X', ...body }, auth, 'k')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      failWith(new InvalidCoinTypeVersionDateError()).createVersion(COIN_TYPE, body, auth, 'k'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      failWith(new IdempotencyKeyConflictError()).createVersion(COIN_TYPE, body, auth, 'k'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      failWith(new CoinMintTypeMismatchError()).createVersion(COIN_TYPE, body, auth, 'k'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const unexpected = new Error('db down');
    await expect(failWith(unexpected).createVersion(COIN_TYPE, body, auth, 'k')).rejects.toBe(unexpected);
  });
});
