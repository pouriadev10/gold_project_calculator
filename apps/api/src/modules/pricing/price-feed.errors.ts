export class PriceFeedTimeoutError extends Error {
  constructor() {
    super('دریافت مظنه از provider در زمان مقرر پاسخ نداد');
    this.name = 'PriceFeedTimeoutError';
  }
}

export class InvalidPriceFeedResultError extends Error {
  constructor() {
    super('provider مظنه‌ی معتبر برنگرداند');
    this.name = 'InvalidPriceFeedResultError';
  }
}

export class PriceQuoteUnavailableError extends Error {
  constructor() {
    super('هیچ مظنه‌ی معتبری برای ادامه‌ی معامله وجود ندارد');
    this.name = 'PriceQuoteUnavailableError';
  }
}
