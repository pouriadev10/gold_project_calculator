import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api/api-error';
import { toast, useToastStore } from './toast-store';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast — افزودن', () => {
  it('هر شدت toast جدا با متن درست اضافه می‌کند', () => {
    toast.success('ثبت شد', 'فاکتور با موفقیت ثبت شد');
    toast.error('ناموفق', 'ثبت انجام نشد');
    toast.warning('توجه', 'مقدار غیرعادی است');
    toast.info('اطلاع', 'مظنه به‌روزرسانی شد');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(4);
    expect(toasts.map((t) => t.variant)).toEqual(['success', 'error', 'warning', 'info']);
    expect(toasts.every((t) => t.open)).toBe(true);
  });

  it('توضیح اختیاری است', () => {
    toast.success('ثبت شد');
    expect(useToastStore.getState().toasts[0]?.description).toBeUndefined();
  });
});

describe('toast — مدت ماندگاری بر اساس شدت', () => {
  it('موفقیت زودتر از خطا و conflict بسته می‌شود', () => {
    toast.success('ثبت شد');
    toast.error('ناموفق');
    const [success, error] = useToastStore.getState().toasts;
    expect(success?.duration).toBeLessThan(error?.duration ?? 0);
  });
});

describe('toast — جلوگیری از تکرار', () => {
  it('toast باز با همان شدت/عنوان/توضیح دوباره اضافه نمی‌شود', () => {
    const firstId = toast.success('ثبت شد', 'فاکتور ۱۲۳۴');
    const secondId = toast.success('ثبت شد', 'فاکتور ۱۲۳۴');

    expect(secondId).toBe(firstId);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('عنوان یا توضیح متفاوت را تکراری حساب نمی‌کند', () => {
    toast.success('ثبت شد', 'فاکتور ۱۲۳۴');
    toast.success('ثبت شد', 'فاکتور ۵۶۷۸');
    toast.success('پیام دیگر');

    expect(useToastStore.getState().toasts).toHaveLength(3);
  });

  it('شدت متفاوت با همان متن را تکراری حساب نمی‌کند', () => {
    toast.error('ثبت شد');
    toast.success('ثبت شد');

    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('بعد از بسته‌شدن کامل، همان پیام دوباره قابل نمایش است', () => {
    vi.useFakeTimers();
    const firstId = toast.success('ثبت شد');

    useToastStore.getState().dismiss(firstId);
    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    const secondId = toast.success('ثبت شد');
    expect(secondId).not.toBe(firstId);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe('toast — بستن', () => {
  it('dismiss بلافاصله حذف نمی‌کند — فقط open را false می‌کند', () => {
    vi.useFakeTimers();
    const id = toast.success('ثبت شد');

    useToastStore.getState().dismiss(id);

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.open).toBe(false);
  });

  it('بعد از تأخیر انیمیشن خروج، از فهرست حذف می‌شود', () => {
    vi.useFakeTimers();
    const id = toast.success('ثبت شد');

    useToastStore.getState().dismiss(id);
    vi.advanceTimersByTime(199);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('toast.apiError — پل به FE-009', () => {
  it('پیام امنِ presentApiError را نشان می‌دهد، نه پیام خام', () => {
    const error = new ApiError(500, 'INTERNAL_ERROR', 'select * from ledger_entries failed');
    toast.apiError(error);

    const item = useToastStore.getState().toasts[0];
    expect(item?.title).toBe('خطا در انجام عملیات');
    expect(item?.description).not.toContain('select');
    expect(item?.variant).toBe('error');
  });

  it('conflict را با شدت warning نشان می‌دهد، نه error', () => {
    const error = new ApiError(409, 'CONFLICT', 'conflict');
    toast.apiError(error);

    expect(useToastStore.getState().toasts[0]?.variant).toBe('warning');
  });

  it('validation را هم warning حساب می‌کند', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'invalid', { weight: ['نامعتبر'] });
    toast.apiError(error);

    expect(useToastStore.getState().toasts[0]?.variant).toBe('warning');
  });

  it('خطای شبکه را هم می‌پوشاند', () => {
    toast.apiError(new NetworkError());
    expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
  });
});
