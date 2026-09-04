import { toPersianDigits } from '@gold/core-calc';

const MASK = '••••';

function maskMiddle(value: string, visibleStart: number, visibleEnd: number): string {
  const normalized = value.trim();
  if (!normalized) return '';

  const minimumMaskedLength = visibleStart + visibleEnd + 1;
  if (normalized.length < minimumMaskedLength) {
    return `${MASK}${normalized.slice(-Math.min(visibleEnd, normalized.length))}`;
  }

  return `${normalized.slice(0, visibleStart)}${MASK}${normalized.slice(-visibleEnd)}`;
}

/** شماره‌ی موبایل برای تأیید بصری کافی می‌ماند، ولی مقدار کامل در DOM قرار نمی‌گیرد. */
export function maskMobileForDisplay(mobile: string): string {
  return toPersianDigits(maskMiddle(mobile, 4, 3));
}

/** کد ملی خام هرگز وارد draft/localStorage نمی‌شود؛ فقط این نمایش پوشانده‌شده مجاز است. */
export function maskNationalIdForDisplay(nationalId: string): string {
  return toPersianDigits(maskMiddle(nationalId, 3, 3));
}
