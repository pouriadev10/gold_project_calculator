/** مشابه محدودیت فروش نسیه‌ی زیورآلات — `paidRial` نمی‌تواند از مبلغ محاسبه‌شده بیشتر باشد. */
export class CoinSalePaidRialExceedsPayableError extends Error {
  constructor() {
    super('Paid Rial cannot exceed the calculated coin sale total');
    this.name = 'CoinSalePaidRialExceedsPayableError';
  }
}
