import { describe, expect, it, vi } from 'vitest';
import { InvoiceAmendmentPolicyService } from './invoice-amendment-policy.service';
import type { Database } from '../../platform/database/connect';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { VersionedSettingsService } from '../pricing/versioned-settings.service';

describe('InvoiceAmendmentPolicyService — start check', () => {
  const finalizedAt = new Date('2026-09-21T09:00:00.000Z');
  const transaction = {} as TenantTransaction;
  const getEffectiveInTransaction = vi.fn(
    async (_transaction: TenantTransaction, _tenantId: string, key: string) => ({
      valueJson: { value: key.endsWith('minutes') ? '30' : '1000' },
    }),
  );
  const service = new InvoiceAmendmentPolicyService(
    {} as Database,
    { getEffectiveInTransaction } as unknown as VersionedSettingsService,
  );
  const input = {
    tenantId: 'tenant',
    actorRole: 'CASHIER' as const,
    finalizedAt,
    requestedAt: new Date('2026-09-21T09:10:00.000Z'),
    businessDayClosed: false,
    isSettled: false,
  };

  it('allows starting inside the configured window without inventing a reason or variance', async () => {
    await expect(service.evaluateStartInTransaction(transaction, input)).resolves.toEqual({
      allowed: true,
      requiresManagerAuthorization: false,
      withinCorrectionWindow: true,
      restrictions: [],
    });
  });

  it('uses the same server policy for time and settlement restrictions', async () => {
    const restricted = {
      ...input,
      requestedAt: new Date('2026-09-21T10:00:00.000Z'),
      isSettled: true,
    };
    await expect(service.evaluateStartInTransaction(transaction, restricted)).resolves.toEqual({
      allowed: false,
      requiresManagerAuthorization: true,
      withinCorrectionWindow: false,
      restrictions: ['OUTSIDE_CORRECTION_WINDOW', 'SETTLED_INVOICE'],
    });
    await expect(
      service.evaluateStartInTransaction(transaction, {
        ...restricted,
        actorRole: 'MANAGER',
      }),
    ).resolves.toMatchObject({ allowed: true, requiresManagerAuthorization: true });
  });
});
