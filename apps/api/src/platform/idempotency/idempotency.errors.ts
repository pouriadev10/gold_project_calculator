/** کلید لازم ارسال نشده یا فقط فاصله است. */
export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super('هدر Idempotency-Key برای عملیات نوشتنی الزامی است');
    this.name = 'MissingIdempotencyKeyError';
  }
}

/** کلید طول نامعقول دارد و نباید به‌عنوان داده‌ی کاربر ذخیره شود. */
export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super('هدر Idempotency-Key معتبر نیست');
    this.name = 'InvalidIdempotencyKeyError';
  }
}

/** یک کلید قبلاً برای درخواست دیگری در همان مستأجر مصرف شده است. */
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super('این Idempotency-Key قبلاً برای درخواست دیگری استفاده شده است');
    this.name = 'IdempotencyKeyConflictError';
  }
}

/** داده‌ای که قرار است hash شود JSON معتبر نیست. */
export class InvalidIdempotencyRequestError extends Error {
  constructor() {
    super('درخواست Idempotency باید JSON معتبر باشد');
    this.name = 'InvalidIdempotencyRequestError';
  }
}
