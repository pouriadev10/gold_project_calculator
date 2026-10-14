import type { QueryClient } from '@tanstack/react-query';
import type { SessionResponse } from '@/api/contracts';
import { SUBMIT_ATTEMPT_STORAGE_PREFIXES } from '@/lib/submit-attempt-storage';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useRecentJewelryItemsStore } from '@/stores/recent-jewelry-items-store';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useToastStore } from '@/stores/toast-store';

/**
 * داده‌ی مستأجر در مرورگر — FE-101: «logout cache tenant را پاک کند» و «ورود tenant دیگر داده‌ی
 * قبلی را نشان ندهد».
 *
 * کش TanStack Query تنها جایی نیست که داده‌ی یک فروشگاه در مرورگر می‌ماند:
 * - `localStorage`: اشخاص اخیر (نام و موبایل مشتری) و کالاهای اخیر — بین نشست‌ها ماندگار؛
 * - `sessionStorage`: پیش‌نویس فروش و خرید (مشتری، اقلام، مبالغ) و تلاش‌های ثبت سنجاق‌شده (بدنه‌ی
 *   مالی درخواست، FE-100)؛
 * - حافظه: toastهایی که نام مشتری یا مبلغ دارند و پس از خروج روی صفحه‌ی ورود می‌مانند.
 *
 * **مالک داده.** `localStorage` بین کاربران یک مرورگر مشترک است و نشستی که منقضی شده (نه خروج
 * عمدی) چیزی پاک نمی‌کند — کاربر بعدی پیش‌نویسش را می‌خواهد اگر همان کاربر باشد. پس شناسه‌ی
 * «مستأجر:کاربر» ِ صاحب داده کنار آن نگه داشته می‌شود و هنگام ورود، اگر کاربر یا مستأجر دیگری وارد
 * شد (یا مالک نامعلوم است)، همه‌چیز پیش از نوشتن نشست تازه پاک می‌شود. تنظیمات نمایشی (واحد، پوسته)
 * داده‌ی مستأجر نیستند و می‌مانند.
 */

export const DATA_OWNER_STORAGE_KEY = 'gold-ui-data-owner';

function ownerOf(session: SessionResponse): string {
  return `${session.tenant.id}:${session.user.id}`;
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(DATA_OWNER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function removeSessionStorageByPrefix(prefixes: readonly string[]): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) sessionStorage.removeItem(key);
    }
  } catch {
    // storage مسدود — چیزی هم در آن ننشسته
  }
}

/** هر داده‌ی مستأجر جاری در این مرورگر را پاک می‌کند (کش، پیش‌نویس، فهرست‌های اخیر، تلاش‌ها، toast). */
export function clearTenantData(queryClient: QueryClient): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  useSaleDraftStore.getState().reset();
  usePurchaseDraftStore.getState().reset();
  useRecentPartiesStore.getState().clear();
  useRecentJewelryItemsStore.getState().clear();
  removeSessionStorageByPrefix(SUBMIT_ATTEMPT_STORAGE_PREFIXES);
  useToastStore.setState({ toasts: [] });
  try {
    localStorage.removeItem(DATA_OWNER_STORAGE_KEY);
  } catch {
    // storage مسدود
  }
}

/**
 * پیش از پذیرفتن نشست تازه (ورود): اگر داده‌ی موجود مال همین مستأجر و کاربر نیست — یا معلوم
 * نیست مال کیست — پاک می‌شود. تمدید نشست (همان کاربر) از این مسیر نمی‌گذرد.
 */
export function claimTenantData(session: SessionResponse, queryClient: QueryClient): void {
  const owner = ownerOf(session);
  if (readOwner() !== owner) clearTenantData(queryClient);
  try {
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, owner);
  } catch {
    // storage مسدود — بدون مالک، ورود بعدی دوباره پاک می‌کند که سمت امن است
  }
}
