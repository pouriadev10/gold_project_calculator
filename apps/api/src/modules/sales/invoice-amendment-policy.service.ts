import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../../platform/database/database.module';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  InvoiceAmendmentPolicyDeniedError,
  InvoiceAmendmentPolicyInvalidInputError,
  InvoiceAmendmentPolicySettingInvalidError,
} from './invoice-amendment-policy.errors';
import type { Database } from '../../platform/database/connect';
import type {
  RoleCode,
  VersionedSetting,
  VersionedSettingValue,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { InvoiceAmendmentRestriction } from './invoice-amendment-policy.errors';

const SETTING_KEYS = {
  correctionWindowMinutes: 'sales.invoice_correction_window_minutes',
  managerApprovalVarianceRial: 'sales.manager_approval_variance_rial',
} as const;

const MANAGER_APPROVAL_ROLES: readonly RoleCode[] = ['OWNER', 'MANAGER'];

export const INVOICE_AMENDMENT_REASONS = [
  'WEIGHT_ERROR',
  'KARAT_ERROR',
  'WAGE_ERROR',
  'PARTY_ERROR',
  'PAYMENT_ERROR',
  'OTHER',
] as const;

export type InvoiceAmendmentReason = (typeof INVOICE_AMENDMENT_REASONS)[number];

export function isInvoiceAmendmentReason(value: string): value is InvoiceAmendmentReason {
  return (INVOICE_AMENDMENT_REASONS as readonly string[]).includes(value);
}

export interface EvaluateInvoiceAmendmentPolicyInput {
  readonly tenantId: string;
  readonly actorRole: RoleCode;
  readonly finalizedAt: Date;
  readonly requestedAt: Date;
  /** Validated at the policy boundary because endpoint input originates as JSON. */
  readonly reason: string;
  readonly reasonDetail?: string | null;
  /** Supplied by the day-closing module when it is introduced. */
  readonly businessDayClosed: boolean;
  /** Supplied by the invoice settlement reader; settlements are party-level today. */
  readonly isSettled: boolean;
  /** Absolute anticipated change in payable Rial, calculated by the amendment workflow. */
  readonly varianceRial: bigint;
}

export interface InvoiceAmendmentPolicyDecision {
  readonly allowed: boolean;
  readonly requiresManagerAuthorization: boolean;
  readonly withinCorrectionWindow: boolean;
  readonly restrictions: readonly InvoiceAmendmentRestriction[];
}

function isSettingRecord(
  value: VersionedSettingValue,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = setting?.valueJson;
  if (
    value === undefined ||
    !isSettingRecord(value) ||
    typeof value['value'] !== 'string' ||
    !/^\d+$/u.test(value['value'])
  ) {
    throw new InvoiceAmendmentPolicySettingInvalidError(key);
  }

  return BigInt(value['value']);
}

function requireValidDate(value: Date, field: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvoiceAmendmentPolicyInvalidInputError(`${field} must be a valid date`);
  }
}

function correctionWindowEnd(finalizedAt: Date, correctionWindowMinutes: bigint): Date {
  if (correctionWindowMinutes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvoiceAmendmentPolicySettingInvalidError(SETTING_KEYS.correctionWindowMinutes);
  }

  const windowEnd = new Date(finalizedAt);
  windowEnd.setUTCMinutes(windowEnd.getUTCMinutes() + Number(correctionWindowMinutes));
  return windowEnd;
}

function hasManagerAuthorization(role: RoleCode): boolean {
  return MANAGER_APPROVAL_ROLES.includes(role);
}

/**
 * Authorization policy only: it neither reads nor changes invoice, ledger, or
 * inventory records. The amendment workflow supplies its known state and uses
 * this result before creating a new invoice version.
 */
@Injectable()
export class InvoiceAmendmentPolicyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async evaluate(
    input: EvaluateInvoiceAmendmentPolicyInput,
  ): Promise<InvoiceAmendmentPolicyDecision> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.evaluateInTransaction(transaction, input),
    );
  }

  async evaluateInTransaction(
    transaction: TenantTransaction,
    input: EvaluateInvoiceAmendmentPolicyInput,
  ): Promise<InvoiceAmendmentPolicyDecision> {
    this.validateInput(input);

    const [correctionWindow, managerApprovalVariance] = await Promise.all([
      this.settings.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        SETTING_KEYS.correctionWindowMinutes,
        input.requestedAt,
      ),
      this.settings.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        SETTING_KEYS.managerApprovalVarianceRial,
        input.requestedAt,
      ),
    ]);

    const correctionWindowMinutes = nonNegativeIntegerSetting(
      correctionWindow,
      SETTING_KEYS.correctionWindowMinutes,
    );
    const managerApprovalVarianceRial = nonNegativeIntegerSetting(
      managerApprovalVariance,
      SETTING_KEYS.managerApprovalVarianceRial,
    );
    const withinCorrectionWindow =
      input.requestedAt.getTime() <=
      correctionWindowEnd(input.finalizedAt, correctionWindowMinutes).getTime();
    const restrictions: InvoiceAmendmentRestriction[] = [];

    if (!withinCorrectionWindow) {
      restrictions.push('OUTSIDE_CORRECTION_WINDOW');
    }
    if (input.businessDayClosed) {
      restrictions.push('BUSINESS_DAY_CLOSED');
    }
    if (input.isSettled) {
      restrictions.push('SETTLED_INVOICE');
    }
    if (input.varianceRial > managerApprovalVarianceRial) {
      restrictions.push('VARIANCE_EXCEEDS_MANAGER_THRESHOLD');
    }

    const requiresManagerAuthorization = restrictions.length > 0;
    return {
      allowed: !requiresManagerAuthorization || hasManagerAuthorization(input.actorRole),
      requiresManagerAuthorization,
      withinCorrectionWindow,
      restrictions,
    };
  }

  async assertPermitted(input: EvaluateInvoiceAmendmentPolicyInput): Promise<void> {
    const decision = await this.evaluate(input);
    if (!decision.allowed) {
      throw new InvoiceAmendmentPolicyDeniedError(decision.restrictions);
    }
  }

  async assertPermittedInTransaction(
    transaction: TenantTransaction,
    input: EvaluateInvoiceAmendmentPolicyInput,
  ): Promise<void> {
    const decision = await this.evaluateInTransaction(transaction, input);
    if (!decision.allowed) {
      throw new InvoiceAmendmentPolicyDeniedError(decision.restrictions);
    }
  }

  private validateInput(input: EvaluateInvoiceAmendmentPolicyInput): void {
    requireValidDate(input.finalizedAt, 'finalizedAt');
    requireValidDate(input.requestedAt, 'requestedAt');

    if (input.requestedAt.getTime() < input.finalizedAt.getTime()) {
      throw new InvoiceAmendmentPolicyInvalidInputError('requestedAt cannot be before finalizedAt');
    }
    if (input.varianceRial < 0n) {
      throw new InvoiceAmendmentPolicyInvalidInputError('varianceRial must be non-negative');
    }
    if (!isInvoiceAmendmentReason(input.reason)) {
      throw new InvoiceAmendmentPolicyInvalidInputError(
        'reason must be a supported amendment reason',
      );
    }
    const reasonDetail = input.reasonDetail?.trim() ?? '';
    if (input.reason === 'OTHER' && reasonDetail === '') {
      throw new InvoiceAmendmentPolicyInvalidInputError(
        'reasonDetail is required when reason is OTHER',
      );
    }
  }
}
