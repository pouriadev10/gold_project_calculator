/** تاریخ نسخه‌ی جدید باید بعد از آغاز نسخه‌ی باز فعلی باشد. */
export class InvalidSettingVersionDateError extends Error {
  constructor() {
    super('تاریخ اعتبار نسخه‌ی جدید باید بعد از نسخه‌ی فعلی باشد');
    this.name = 'InvalidSettingVersionDateError';
  }
}

/** هم‌زمانی یا دخالت مستقیم باعث شد نسخه‌ی باز مورد انتظار بسته نشود. */
export class SettingVersionConflictError extends Error {
  constructor() {
    super('نسخه‌ی تنظیمات هم‌زمان تغییر کرده است؛ دوباره تلاش کنید');
    this.name = 'SettingVersionConflictError';
  }
}
