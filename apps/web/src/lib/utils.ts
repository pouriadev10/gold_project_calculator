import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** ادغام کلاس‌های Tailwind با حل تعارض. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
