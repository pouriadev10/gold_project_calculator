import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/api-error';
import { toast, useToastStore } from '@/stores/toast-store';
import { Toaster } from './Toaster';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('Toaster', () => {
  it('بدون هیچ toast فعالی چیزی رندر نمی‌کند', () => {
    render(<Toaster />);
    expect(screen.queryByText(/./)).not.toBeInTheDocument();
  });

  it('toast موفقیت را با عنوان و توضیح نشان می‌دهد', async () => {
    render(<Toaster />);
    act(() => {
      toast.success('فاکتور ثبت شد', 'شماره ۱۰۰۱ صادر شد');
    });

    expect(await screen.findByText('فاکتور ثبت شد')).toBeInTheDocument();
    expect(screen.getByText('شماره ۱۰۰۱ صادر شد')).toBeInTheDocument();
  });

  it('toast خطا را نشان می‌دهد', async () => {
    render(<Toaster />);
    act(() => {
      toast.error('ثبت ناموفق بود', 'دوباره تلاش کنید');
    });

    expect(await screen.findByText('ثبت ناموفق بود')).toBeInTheDocument();
  });

  it('conflict را از طریق toast.apiError نشان می‌دهد', async () => {
    render(<Toaster />);
    act(() => {
      toast.apiError(new ApiError(409, 'CONFLICT', 'conflict'));
    });

    expect(await screen.findByText('تغییر هم‌زمان در داده‌ها')).toBeInTheDocument();
    expect(
      screen.getByText('اطلاعات تغییر کرده است. صفحه را تازه‌سازی کنید و دوباره بررسی کنید.'),
    ).toBeInTheDocument();
  });

  it('چند شدت هم‌زمان قابل نمایش‌اند و به هم اثر نمی‌گذارند', async () => {
    render(<Toaster />);
    act(() => {
      toast.success('اول');
      toast.error('دوم');
      toast.warning('سوم');
    });

    expect(await screen.findByText('اول')).toBeInTheDocument();
    expect(screen.getByText('دوم')).toBeInTheDocument();
    expect(screen.getByText('سوم')).toBeInTheDocument();
  });

  it('دکمه‌ی بستن toast را می‌بندد', async () => {
    render(<Toaster />);
    const user = userEvent.setup();
    act(() => {
      toast.success('فاکتور ثبت شد');
    });

    await screen.findByText('فاکتور ثبت شد');
    await user.click(screen.getByRole('button', { name: 'بستن' }));

    await waitFor(() => {
      expect(screen.queryByText('فاکتور ثبت شد')).not.toBeInTheDocument();
    });
  });

  it('توضیح ندادن باعث رندر توضیح خالی نمی‌شود', async () => {
    render(<Toaster />);
    act(() => {
      toast.success('فقط عنوان');
    });

    const title = await screen.findByText('فقط عنوان');
    // فقط یک متن فرزند دارد: عنوان — بدون پاراگراف توضیح خالی کنارش
    expect(title.parentElement?.children).toHaveLength(1);
  });
});
