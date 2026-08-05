export class InvalidJewelryItemVersionDateError extends Error {
  constructor() {
    super('Jewelry item version date must be after the current version start');
    this.name = 'InvalidJewelryItemVersionDateError';
  }
}

export class JewelryItemVersionConflictError extends Error {
  constructor() {
    super('Jewelry item version changed concurrently; retry the operation');
    this.name = 'JewelryItemVersionConflictError';
  }
}

/**
 * کسورات از وزن ناخالص بیشتر است.
 *
 * پیش از رسیدن به دیتابیس گرفته می‌شود تا پیام قابل‌فهم باشد؛ محدودیت
 * `jewelry_item_versions_deduction_within_gross_check` همان قاعده را در
 * لایه‌ی ذخیره‌سازی هم اجبار می‌کند.
 */
export class JewelryDeductionExceedsGrossError extends Error {
  constructor() {
    super('Stone and other deductions cannot exceed the gross weight');
    this.name = 'JewelryDeductionExceedsGrossError';
  }
}

export class InvalidJewelryKaratError extends Error {
  readonly karat: number;

  constructor(karat: number) {
    super(`Karat must be an integer between 1 and 1000; received ${karat}`);
    this.name = 'InvalidJewelryKaratError';
    this.karat = karat;
  }
}

/** وزن ناخالص باید مثبت باشد و کسورات و اجرت نمی‌توانند منفی باشند. */
export class InvalidJewelryWeightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJewelryWeightError';
  }
}

export class JewelryItemCodeConflictError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Jewelry item code "${code}" already exists for this tenant`);
    this.name = 'JewelryItemCodeConflictError';
    this.code = code;
  }
}
