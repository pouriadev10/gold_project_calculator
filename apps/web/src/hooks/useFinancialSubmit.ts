import { useCallback, useRef, useState } from 'react';
import type { z } from 'zod';
import { ApiError, OfflineError } from '@/api/api-error';
import { newIdempotencyKey } from '@/api/client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { SUBMIT_ATTEMPT_STORAGE_PREFIX } from '@/lib/submit-attempt-storage';
import { useSessionStore } from '@/stores/session-store';

/**
 * ثبت یک سند مالی — FE-100: «یک عملیات منطقی فقط یک سند می‌سازد».
 *
 * `useIdempotentSubmit` کلید را پایدار نگه می‌دارد ولی بدنه را نه: هر ضربه بدنه را از نو
 * می‌سازد (`effectiveAt` تازه، فیلد ویرایش‌شده). سرور hash ِ بدنه را کنار کلید نگه می‌دارد
 * (`request-hash.ts`)، پس «همان کلید + بدنه‌ی دیگر» پس از پاسخی که در راه گم شده ۴۰۹ می‌گیرد
 * — و اگر کاربر بعد از آن صفحه را ترک کند و برگردد، کلید تازه یعنی سند دوم.
 *
 * این هوک **تلاش** را سنجاق می‌کند، نه فقط کلید را: اولین ضربه `{ key, payload }` را ثابت
 * می‌کند و تا پاسخ قطعی سرور همان دو با هم دوباره فرستاده می‌شوند — هر ضربه‌ی بعدی (دکمه،
 * Enter، tap سریع، «بررسی نتیجه» پس از خطای شبکه، بازگشت با back/forward) فقط همان درخواست
 * را تکرار می‌کند و سرور با دیدن همان کلید و همان بدنه، پاسخ ذخیره‌شده را برمی‌گرداند.
 * غیرفعال‌شدن دکمه فقط راحتی است؛ درستی از Idempotency می‌آید.
 *
 * چرخه‌ی تلاش:
 * - `sending` — در جریان. ضربه‌ی دیگر سنکرون (روی ref) نادیده گرفته می‌شود.
 * - `uncertain` — شبکه/timeout/5xx: معلوم نیست سند ساخته شده یا نه. فرم باید قفل بماند
 *   (`locked`) و تنها اقدام «بررسی نتیجه» است که همان درخواست را می‌فرستد.
 * - پاسخ قطعی رد (`isDefinitiveRejection`): تراکنش سرور rollback شده و چیزی ساخته نشده —
 *   تلاش رها می‌شود تا کاربر اصلاح کند. کلید می‌ماند؛ سرور رکوردش را با همان rollback پاک کرده.
 * - `done` — موفق. ضربه‌ی دیرهنگام (پیش از رندر رسید) هیچ نمی‌فرستد؛ عملیات بعدی فقط با
 *   `reset()` و کلید تازه شروع می‌شود.
 *
 * با `persist`، تلاش نامطمئن در sessionStorage ِ همین تب می‌ماند (جدا برای هر مستأجر و
 * کاربر): ترک صفحه، back/forward یا تازه‌سازی آن را گم نمی‌کند و فرم با «بررسی نتیجه»
 * برمی‌گردد، نه با کلید تازه. فقط درخواستی که روی سیم رفته ذخیره می‌شود — نه پیش‌نویس.
 */

export interface PinnedAttempt<TPayload> {
  readonly key: string;
  readonly payload: TPayload;
}

export interface FinancialSubmitOptions<TPayload> {
  readonly persist?: {
    /** شناسه‌ی پایدار همان فرم، مثلاً `settlement:rial:<partyId>`. */
    readonly scope: string;
    /** بدنه‌ی بازیابی‌شده دوباره اعتبارسنجی می‌شود؛ داده‌ی خراب یعنی «تلاشی نیست». */
    readonly schema: z.ZodType<TPayload, z.ZodTypeDef, unknown>;
  };
}

export interface FinancialSubmit<TPayload, TResult> {
  /**
   * ثبت. اگر تلاشی سنجاق شده باشد، `payload` نادیده گرفته می‌شود و همان تلاش تکرار می‌شود.
   * `undefined` یعنی چیزی فرستاده نشد (ضربه‌ی تکراری حین ارسال، یا پس از موفقیت).
   */
  readonly submit: (payload: TPayload) => Promise<TResult | undefined>;
  /** تکرار تلاش سنجاق‌شده — بی‌اثر اگر تلاشی نیست. */
  readonly retry: () => Promise<TResult | undefined>;
  readonly isSubmitting: boolean;
  /** تلاشی روی سیم رفته و پاسخ قطعی‌اش نیامده — فرم باید قفل باشد. */
  readonly locked: boolean;
  /** پاسخ تلاش قبلی نامشخص است و الان چیزی در جریان نیست — «بررسی نتیجه» نشان بده. */
  readonly uncertain: boolean;
  readonly pending: PinnedAttempt<TPayload> | null;
  readonly key: string;
  readonly reset: () => void;
  readonly offline: boolean;
}

/**
 * آیا این خطا قطعاً یعنی «هیچ سندی ساخته نشد»؟
 *
 * سرور اثر هر عملیات را در همان تراکنشی می‌نویسد که رکورد Idempotency را می‌سازد؛ هر خطای
 * دامنه یا اعتبارسنجی (۴xx) کل آن را rollback می‌کند. ۴۰۹ هم قطعی است: با بدنه‌ی سنجاق‌شده،
 * «کلید با بدنه‌ی دیگر» پیش نمی‌آید، پس ۴۰۹ تعارض دامنه است یا `RETRY_AFTER_REFRESH` ِ
 * کلاینت (درخواست با ۴۰۱ رد شده). OfflineError اصلاً فرستاده نشده.
 *
 * نامطمئن: خطای شبکه و timeout (شاید سرور ثبت کرده و پاسخ گم شده)، ۵xx (شاید پروکسی پس از
 * commit)، ۴۰۸/۴۲۹، و `SCHEMA_MISMATCH` که روی پاسخ موفق رخ می‌دهد — یعنی سند ساخته شده.
 */
export function isDefinitiveRejection(error: unknown): boolean {
  if (error instanceof OfflineError) return true;
  if (!(error instanceof ApiError)) return false;
  if (error.code === 'SCHEMA_MISMATCH') return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

type Phase = 'idle' | 'sending' | 'uncertain' | 'done';

interface Snapshot<TPayload> {
  readonly storageKey: string | null;
  readonly key: string;
  readonly attempt: PinnedAttempt<TPayload> | null;
  readonly phase: Phase;
}

function storageKeyFor(scope: string | undefined): string | null {
  if (scope === undefined) return null;
  const session = useSessionStore.getState().session;
  // بدون نشست چیزی ذخیره نمی‌شود — تلاش یک کاربر هرگز با توکن کاربر دیگری فرستاده نمی‌شود
  if (!session) return null;
  return `${SUBMIT_ATTEMPT_STORAGE_PREFIX}${session.tenant.id}:${session.user.id}:${scope}`;
}

function readStored<TPayload>(
  storageKey: string | null,
  schema: z.ZodType<TPayload, z.ZodTypeDef, unknown> | undefined,
): PinnedAttempt<TPayload> | null {
  if (storageKey === null || schema === undefined) return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null) return null;
    const record = stored as Record<string, unknown>;
    const parsed = schema.safeParse(record.payload);
    return typeof record.key === 'string' && record.key.length > 0 && parsed.success
      ? { key: record.key, payload: parsed.data }
      : null;
  } catch {
    return null;
  }
}

function writeStored<TPayload>(storageKey: string | null, attempt: PinnedAttempt<TPayload> | null): void {
  if (storageKey === null) return;
  try {
    if (attempt) sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // storage پر یا مسدود — قفل درون‌حافظه‌ای همچنان کار می‌کند، فقط بازگشت به صفحه پوشش ندارد
  }
}

function initialSnapshot<TPayload>(options: FinancialSubmitOptions<TPayload> | undefined): Snapshot<TPayload> {
  const storageKey = storageKeyFor(options?.persist?.scope);
  const restored = readStored(storageKey, options?.persist?.schema);
  // تلاشی که از mount قبلی مانده، پاسخش هرگز به این صفحه نرسیده — نامطمئن است
  return restored
    ? { storageKey, key: restored.key, attempt: restored, phase: 'uncertain' }
    : { storageKey, key: newIdempotencyKey(), attempt: null, phase: 'idle' };
}

export function useFinancialSubmit<TPayload, TResult>(
  action: (key: string, payload: TPayload) => Promise<TResult>,
  options?: FinancialSubmitOptions<TPayload>,
): FinancialSubmit<TPayload, TResult> {
  const offline = !useOnlineStatus();
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(options));
  const current = useRef(snapshot);
  const inFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /*
   * فرم برای طرف حساب دیگری (scope دیگر) همان نمونه‌ی کامپوننت را نگه می‌دارد — تلاش
   * شخص قبلی نباید روی شخص تازه بماند. بازسازی در همان رندر (الگوی «state مشتق» ری‌اکت).
   */
  const wantedStorageKey = storageKeyFor(options?.persist?.scope);
  if (wantedStorageKey !== snapshot.storageKey && !inFlight.current) {
    const next = initialSnapshot(options);
    current.current = next;
    setSnapshot(next);
  }

  const update = useCallback((next: Snapshot<TPayload>) => {
    current.current = next;
    setSnapshot(next);
  }, []);

  const send = useCallback(
    async (payload: TPayload | undefined): Promise<TResult | undefined> => {
      if (inFlight.current) return undefined;
      const state = current.current;
      if (state.phase === 'done') return undefined;
      const attempt = state.attempt ?? (payload === undefined ? null : { key: state.key, payload });
      if (attempt === null) return undefined;

      inFlight.current = true;
      setIsSubmitting(true);
      update({ ...state, attempt, phase: 'sending' });
      writeStored(state.storageKey, attempt);
      try {
        const result = await action(attempt.key, attempt.payload);
        writeStored(state.storageKey, null);
        update({ ...current.current, attempt: null, phase: 'done' });
        return result;
      } catch (caught) {
        if (isDefinitiveRejection(caught)) {
          writeStored(state.storageKey, null);
          update({ ...current.current, attempt: null, phase: 'idle' });
        } else {
          update({ ...current.current, phase: 'uncertain' });
        }
        throw caught;
      } finally {
        inFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [action, update],
  );

  const submit = useCallback((payload: TPayload) => send(payload), [send]);
  const retry = useCallback(() => send(undefined), [send]);

  const reset = useCallback(() => {
    if (inFlight.current) return;
    const state = current.current;
    writeStored(state.storageKey, null);
    update({ ...state, key: newIdempotencyKey(), attempt: null, phase: 'idle' });
  }, [update]);

  const pending = snapshot.phase === 'sending' || snapshot.phase === 'uncertain' ? snapshot.attempt : null;

  return {
    submit,
    retry,
    isSubmitting,
    locked: pending !== null,
    uncertain: snapshot.phase === 'uncertain' && !isSubmitting,
    pending,
    key: snapshot.key,
    reset,
    offline,
  };
}
