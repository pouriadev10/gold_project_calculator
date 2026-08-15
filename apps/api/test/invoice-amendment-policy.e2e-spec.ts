import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  InvoiceAmendmentPolicyDeniedError,
  InvoiceAmendmentPolicyInvalidInputError,
} from '../src/modules/sales/invoice-amendment-policy.errors';
import { InvoiceAmendmentPolicyService } from '../src/modules/sales/invoice-amendment-policy.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { tenants } from '../src/platform/database/schema';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';
import type { EvaluateInvoiceAmendmentPolicyInput } from '../src/modules/sales/invoice-amendment-policy.service';

describe('invoice amendment policy (BE-053)', () => {
  const tenant = { id: '', slug: `invoice-amendment-policy-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let policy: InvoiceAmendmentPolicyService;
  let finalizedAt: Date;

  function input(
    overrides: Partial<EvaluateInvoiceAmendmentPolicyInput> = {},
  ): EvaluateInvoiceAmendmentPolicyInput {
    return {
      tenantId: tenant.id,
      actorRole: 'CASHIER',
      finalizedAt,
      requestedAt: new Date(finalizedAt),
      reason: 'WEIGHT_ERROR',
      businessDayClosed: false,
      isSettled: false,
      varianceRial: 0n,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    policy = app.get(InvoiceAmendmentPolicyService);
    tenant.id = (
      await app.get(TenantService).create({
        name: 'Invoice amendment policy tenant',
        slug: tenant.slug,
      })
    ).id;
    finalizedAt = new Date();
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('allows a Cashier inside the configured correction window without a restriction', async () => {
    await expect(policy.evaluate(input())).resolves.toEqual({
      allowed: true,
      requiresManagerAuthorization: false,
      withinCorrectionWindow: true,
      restrictions: [],
    });
  });

  it.each(['MANAGER', 'OWNER'] as const)(
    'allows %s after the correction window while denying the same amendment to a Cashier',
    async (actorRole) => {
      const requestedAt = new Date(finalizedAt);
      requestedAt.setUTCDate(requestedAt.getUTCDate() + 1);

      await expect(policy.assertPermitted(input({ requestedAt }))).rejects.toBeInstanceOf(
        InvoiceAmendmentPolicyDeniedError,
      );
      await expect(policy.evaluate(input({ actorRole, requestedAt }))).resolves.toMatchObject({
        allowed: true,
        requiresManagerAuthorization: true,
        withinCorrectionWindow: false,
        restrictions: ['OUTSIDE_CORRECTION_WINDOW'],
      });
    },
  );

  it('requires Manager or Owner authorization for a closed business day, settled invoice, or variance above the setting', async () => {
    const restricted = input({
      businessDayClosed: true,
      isSettled: true,
      varianceRial: 1n,
    });

    await expect(policy.evaluate(restricted)).resolves.toMatchObject({
      allowed: false,
      requiresManagerAuthorization: true,
      restrictions: [
        'BUSINESS_DAY_CLOSED',
        'SETTLED_INVOICE',
        'VARIANCE_EXCEEDS_MANAGER_THRESHOLD',
      ],
    });
    await expect(
      policy.assertPermitted({ ...restricted, actorRole: 'MANAGER' }),
    ).resolves.toBeUndefined();
  });

  it('requires a written reason when OTHER is selected', async () => {
    await expect(policy.evaluate(input({ reason: '' }))).rejects.toBeInstanceOf(
      InvoiceAmendmentPolicyInvalidInputError,
    );
    await expect(
      policy.evaluate(input({ reason: 'OTHER', reasonDetail: '  ' })),
    ).rejects.toBeInstanceOf(InvoiceAmendmentPolicyInvalidInputError);
    await expect(
      policy.evaluate(
        input({ reason: 'OTHER', reasonDetail: 'Customer payment was entered twice' }),
      ),
    ).resolves.toMatchObject({ allowed: true });
  });
});
