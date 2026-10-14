import type { QueryClient } from '@tanstack/react-query';
import type { SessionResponse } from '@/api/contracts';
import { SUBMIT_ATTEMPT_STORAGE_PREFIXES } from '@/lib/submit-attempt-storage';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useRecentJewelryItemsStore } from '@/stores/recent-jewelry-items-store';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useToastStore } from '@/stores/toast-store';

/**
 * داده‌ی مستأجر در مرورگر — FE-101 («logout cache tenant را پاک کند»، «ورود tenant دیگر داده‌ی
 * قبلی را نشان ندهد») و FE-102 (تعویض مستأجر).
 *
 * کش TanStack Query تنها جایی نیست که داده‌ی یک فروشگاه در مرورگر می‌ماند. دو دسته داریم:
 * - **مشترک بین تب‌ها** (`localStorage`): اشخاص اخیر (نام و موبایل مشتری) و کالاهای اخیر؛
 * - **مال همین تب**: کش TanStack Query (حافظه)، پیش‌نویس فروش و خرید و تلاش‌های ثبت سنجاق‌شده‌ی
 *   FE-100 (`sessionStorage`)، و toastها (حافظه).
 *
 * **مالک داده.** کنار هر دسته شناسه‌ی «مستأجر:کاربر» ِ صاحبش نگه داشته می‌شود: مشترک در
 * `localStorage`، تب در `sessionStorage`. نشست (توکن) در `localStorage` بین تب‌ها مشترک است؛ پس
 * ورود فروشگاه دیگر در یک تب، نشست تب دیگر را هم عوض می‌کند — بی‌آنکه آن تب خروجی دیده باشد.
 * مالک تب همین را آشکار می‌کند: تب پیش‌نویس و کش مستأجر قبلی را دارد و باید پاکشان کند.
 * تنظیمات نمایشی (واحد، پوسته) داده‌ی مستأجر نیستند و می‌مانند.
 */

export const DATA_OWNER_STORAGE_KEY = 'gold-ui-data-owner';
export const TAB_DATA_OWNER_STORAGE_KEY = 'gold-ui-tab-data-owner';

export function tenantDataOwner(session: SessionResponse): string {
  return `${session.tenant.id}:${session.user.id}`;
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // storage مسدود — بدون مالک، ورود بعدی دوباره پاک می‌کند که سمت امن است
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

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

/** داده‌ی همین تب: کش (و درخواست‌های در جریان)، پیش‌نویس‌ها، تلاش‌های ثبت، toastها. */
function clearTabData(queryClient: QueryClient): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  useSaleDraftStore.getState().reset();
  usePurchaseDraftStore.getState().reset();
  removeSessionStorageByPrefix(SUBMIT_ATTEMPT_STORAGE_PREFIXES);
  useToastStore.setState({ toasts: [] });
}

/** داده‌ی مشترک بین تب‌ها پاک می‌شود (حافظه و `localStorage`). */
function clearSharedData(): void {
  useRecentPartiesStore.getState().clear();
  useRecentJewelryItemsStore.getState().clear();
}

/**
 * نسخه‌ی حافظه‌ی داده‌ی مشترک از `localStorage` خوانده می‌شود — وقتی تب دیگری مالک تازه را
 * پذیرفته و `localStorage` مال اوست، ولی حافظه‌ی این تب هنوز فهرست مستأجر قبلی را دارد.
 */
function reloadSharedData(): void {
  void useRecentPartiesStore.persist.rehydrate();
  void useRecentJewelryItemsStore.persist.rehydrate();
}

function writeOwners(owner: string | null): void {
  write(local, DATA_OWNER_STORAGE_KEY, owner);
  write(session, TAB_DATA_OWNER_STORAGE_KEY, owner);
}

/** خروج عمدی: هر داده‌ی مستأجر جاری در این مرورگر پاک می‌شود. */
export function clearTenantData(queryClient: QueryClient): void {
  clearTabData(queryClient);
  clearSharedData();
  writeOwners(null);
}

/**
 * ورود (پیش از نوشتن نشست تازه): داده‌ی مشترکی که مال همین مستأجر و کاربر نیست — یا معلوم
 * نیست مال کیست — پاک می‌شود؛ داده‌ی تبی که مالک دیگری دارد هم. تمدید نشست از این مسیر نمی‌گذرد.
 */
export function claimTenantData(nextSession: SessionResponse, queryClient: QueryClient): void {
  const owner = tenantDataOwner(nextSession);
  const tab = read(session, TAB_DATA_OWNER_STORAGE_KEY);
  if (read(local, DATA_OWNER_STORAGE_KEY) !== owner) {
    clearTabData(queryClient);
    clearSharedData();
  } else if (tab !== null && tab !== owner) {
    clearTabData(queryClient);
    reloadSharedData();
  }
  writeOwners(owner);
}

/**
 * آیا این تب داده‌ای از مالکی غیر از نشست جاری دارد؟ مالک نامعلوم (تب تازه، یا پیش از FE-101)
 * ناسازگار حساب نمی‌شود — تب تازه چیزی ندارد و داده‌ی مشترک را ورود (`claimTenantData`) سنجیده.
 */
export function hasForeignTenantData(current: SessionResponse): boolean {
  const owner = tenantDataOwner(current);
  const shared = read(local, DATA_OWNER_STORAGE_KEY);
  const tab = read(session, TAB_DATA_OWNER_STORAGE_KEY);
  return (shared !== null && shared !== owner) || (tab !== null && tab !== owner);
}

/**
 * پوسته‌ی برنامه با نشست جاری هم‌راستا می‌شود (FE-102).
 *
 * `switched`: همین پوسته تا لحظه‌ای پیش داده‌ی مالک دیگری را نشان می‌داد (نشست زیر پایش عوض
 * شد) — داده‌ی تب، صرف‌نظر از نشانگرها، مال قبلی است و پاک می‌شود. داده‌ی مشترک اگر
 * `localStorage` حالا مال مالک تازه است از آن دوباره خوانده، وگرنه پاک می‌شود.
 */
export function adoptTenantData(current: SessionResponse, queryClient: QueryClient, switched: boolean): void {
  const owner = tenantDataOwner(current);
  const shared = read(local, DATA_OWNER_STORAGE_KEY);
  const tab = read(session, TAB_DATA_OWNER_STORAGE_KEY);
  const sharedForeign = shared !== null && shared !== owner;
  if (switched || sharedForeign || (tab !== null && tab !== owner)) {
    clearTabData(queryClient);
    if (sharedForeign || (switched && shared !== owner)) clearSharedData();
    else reloadSharedData();
  }
  writeOwners(owner);
}
