import 'reflect-metadata';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceAmendmentsController } from './invoice-amendments.controller';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import type { InvoiceAmendmentsService } from './invoice-amendments.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service';

describe('InvoiceAmendmentsController — read-only preflight', () => {
  const invoiceId = 'd5000000-0000-4000-8000-000000000001';
  const decision = {
    invoiceId,
    invoiceVersion: 1,
    evaluatedAt: '2026-09-21T09:10:00.000Z',
    allowed: false,
    requiresManagerAuthorization: true,
    restrictions: ['OUTSIDE_CORRECTION_WINDOW'] as const,
  };
  const getPreflight = vi.fn();
  const controller = new InvoiceAmendmentsController(
    { getTenantId: () => 'tenant-id' } as RequestContextService,
    {} as IdempotencyService,
    { getPreflight } as unknown as InvoiceAmendmentsService,
  );
  const auth = { sub: 'user-id', tid: 'tenant-id', role: 'CASHIER' as const };

  it('returns the server decision for the authenticated tenant and role', async () => {
    getPreflight.mockResolvedValueOnce(decision);
    await expect(controller.getPreflight(invoiceId, auth)).resolves.toEqual(decision);
    expect(getPreflight).toHaveBeenCalledWith('tenant-id', invoiceId, 'CASHIER');
  });

  it('does not disclose a decision without authentication or for another tenant invoice', async () => {
    await expect(controller.getPreflight(invoiceId, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    getPreflight.mockRejectedValueOnce(new SalesInvoiceNotFoundError(invoiceId));
    await expect(controller.getPreflight(invoiceId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
