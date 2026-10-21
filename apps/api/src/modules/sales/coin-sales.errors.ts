import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';

/** مشابه محدودیت فروش نسیه‌ی زیورآلات — `paidRial` نمی‌تواند از مبلغ محاسبه‌شده بیشتر باشد. */
export class CoinSalePaidRialExceedsPayableError extends BusinessRuleError {
  constructor() {
    super('Paid Rial cannot exceed the calculated coin sale total', 'مبلغ پرداختی از مبلغ فاکتور بیشتر است');
    this.name = 'CoinSalePaidRialExceedsPayableError';
  }
}
