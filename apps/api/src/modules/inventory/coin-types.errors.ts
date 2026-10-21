import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';
import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';

export class InvalidCoinTypeVersionDateError extends Error {
  constructor() {
    super('Coin type version date must be after the current version start');
    this.name = 'InvalidCoinTypeVersionDateError';
  }
}

export class CoinTypeVersionConflictError extends Error {
  constructor() {
    super('Coin type version changed concurrently; retry the operation');
    this.name = 'CoinTypeVersionConflictError';
  }
}

export class CoinMintTypeMismatchError extends Error {
  constructor() {
    super('Only CENTRAL_BANK coin types may be marked as central-bank minted');
    this.name = 'CoinMintTypeMismatchError';
  }
}

export class CoinTypeNotFoundError extends ResourceNotFoundError {
  readonly coinTypeId: string;

  constructor(coinTypeId: string) {
    super(`Coin type "${coinTypeId}" was not found for this tenant`);
    this.name = 'CoinTypeNotFoundError';
    this.coinTypeId = coinTypeId;
  }
}

/**
 * نسخه‌ی غیرفعال سکه در معامله‌ی جدید انتخاب شده است — همان معیار BE-026
 * برای کالای زیورآلات، برای سکه. فروش سکه و تسویه‌ی سکه‌ای/ترکیبی آن را ترجمه نمی‌کردند و
 * ۵۰۰ می‌دادند؛ از M-14 قاعده‌ی کسب‌وکار است (۴۲۲).
 */
export class InactiveCoinTypeError extends BusinessRuleError {
  readonly coinTypeId: string;

  constructor(coinTypeId: string) {
    super(
      `Coin type "${coinTypeId}" is inactive and cannot be used in a new transaction`,
      'این نوع سکه غیرفعال است و در معامله‌ی تازه انتخاب نمی‌شود',
    );
    this.name = 'InactiveCoinTypeError';
    this.coinTypeId = coinTypeId;
  }
}

/** کد نوع سکه در این مستأجر تکراری است — کد هویت ثابت نوع است و دوبار ساخته نمی‌شود. */
export class CoinTypeCodeConflictError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Coin type code "${code}" already exists for this tenant`);
    this.name = 'CoinTypeCodeConflictError';
    this.code = code;
  }
}
