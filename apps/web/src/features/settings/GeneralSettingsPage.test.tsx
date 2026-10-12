import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { GeneralSettings, SessionResponse } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import type * as SettingsApi from '@/api/settings';
import { ApiError } from '@/api/api-error';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { useSessionStore } from '@/stores/session-store';
import GeneralSettingsPage from './GeneralSettingsPage';

/** FE-080 — صفحه‌ی تنظیمات عمومی مستأجر. */

const useGeneralSettingsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useGeneralSettings: (...args: unknown[]) => useGeneralSettingsMock(...args),
}));

const updateGeneralSettingMock = vi.fn();
vi.mock('@/api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsApi>()),
  updateGeneralSetting: (...args: unknown[]) => updateGeneralSettingMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

const VALID_FROM = '2026-07-01T00:00:00.000Z';

const SETTINGS: GeneralSettings = {
  settings: [
    { key: 'purchase.second_hand_default_karat', value: '740', version: 1, validFrom: VALID_FROM, createdBy: null },
    { key: 'pricing.rial_rounding_unit', value: '1000', version: 2, validFrom: VALID_FROM, createdBy: null },
    { key: 'pricing.rounding_policy', value: 'HALF_UP', version: 1, validFrom: VALID_FROM, createdBy: null },
    { key: 'reporting.default_display_karat', value: '750', version: 1, validFrom: VALID_FROM, createdBy: null },
    { key: 'sales.invoice_correction_window_minutes', value: '30', version: 4, validFrom: VALID_FROM, createdBy: null },
    { key: 'sales.manager_approval_variance_rial', value: '0', version: 1, validFrom: VALID_FROM, createdBy: null },
  ],
};

function session(role: SessionResponse['role']): SessionResponse {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    expiresInSeconds: 900,
    user: { id: 'u1', email: 'owner@example.com', displayName: 'کاربر' },
    tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
    role,
  };
}

function renderPage() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <GeneralSettingsPage />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function card(label: string): HTMLElement {
  return screen.getByRole('heading', { name: label }).closest('[aria-label]') as HTMLElement;
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useGeneralSettingsMock.mockReset();
  useGeneralSettingsMock.mockReturnValue({ data: SETTINGS, isLoading: false, isError: false, refetch: vi.fn() });
  updateGeneralSettingMock.mockReset();
  useSessionStore.setState({ session: session('MANAGER') });
});

afterEach(() => {
  useSessionStore.setState({ session: null });
});

describe('GeneralSettingsPage — FE-080', () => {
  it('shows all six settings from the API with their current version and start', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'تنظیمات عمومی' })).toBeInTheDocument();
    expect(within(card('عیار پیش‌فرض خرید دست‌دوم')).getByText('۷۴۰')).toBeInTheDocument();
    expect(card('واحد گرد کردن').querySelector('[data-raw="1000"]')).not.toBeNull();
    expect(within(card('سیاست گرد کردن')).getByText('نیم به بالا')).toBeInTheDocument();
    expect(within(card('عیار نمایش گزارش')).getByText('۷۵۰')).toBeInTheDocument();
    expect(within(card('پنجره اصلاح فاکتور')).getByText('۳۰')).toBeInTheDocument();
    expect(card('حد اختلاف نیازمند مدیر').querySelector('[data-raw="0"]')).not.toBeNull();
    expect(within(card('پنجره اصلاح فاکتور')).getByText(/نسخه ۴ · از/)).toBeInTheDocument();
  });

  it('a cashier can read but never change', () => {
    useSessionStore.setState({ session: session('CASHIER') });
    renderPage();

    expect(screen.getByText('فقط مالک و مدیر می‌توانند این تنظیمات را تغییر دهند.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^تغییر / })).not.toBeInTheDocument();
  });

  it('saving creates a new backend version and refreshes the list', async () => {
    const user = userEvent.setup();
    updateGeneralSettingMock.mockResolvedValue({
      key: 'pricing.rial_rounding_unit',
      value: '10000',
      version: 3,
      validFrom: '2026-10-11T08:00:00.000Z',
      createdBy: 'u1',
    });
    const { invalidate } = renderPage();

    await user.click(within(card('واحد گرد کردن')).getByRole('button', { name: 'تغییر واحد گرد کردن' }));
    const save = screen.getByRole('button', { name: 'ذخیره نسخه جدید' });
    // بدون تغییر، ذخیره غیرفعال است.
    expect(save).toBeDisabled();
    expect(screen.getByText(/فاکتورها و خریدهای گذشته با تنظیمات زمان خودشان باقی/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('واحد گرد کردن جدید'));
    await user.click(screen.getByRole('button', { name: 'رقم ۰' }));
    expect(screen.getByLabelText('واحد گرد کردن جدید')).toHaveAttribute('data-value', '10000');

    await user.click(save);

    await waitFor(() =>
      expect(updateGeneralSettingMock).toHaveBeenCalledWith(
        { key: 'pricing.rial_rounding_unit', value: '10000' },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings', 'general'] }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ذخیره نسخه جدید' })).not.toBeInTheDocument());
  });

  it('blocks a value the server would reject, using the shared contract rule', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(card('عیار پیش‌فرض خرید دست‌دوم')).getByRole('button', { name: 'تغییر عیار پیش‌فرض خرید دست‌دوم' }));
    await user.click(screen.getByLabelText('عیار پیش‌فرض خرید دست‌دوم جدید'));
    // ۷۴۰ → ۷۴۰۰: بیرون از ۱ تا ۱۰۰۰.
    await user.click(screen.getByRole('button', { name: 'رقم ۰' }));

    expect(screen.getByRole('button', { name: 'ذخیره نسخه جدید' })).toBeDisabled();
    expect(updateGeneralSettingMock).not.toHaveBeenCalled();
  });

  it('keeps the editor open with the server error when saving fails', async () => {
    const user = userEvent.setup();
    updateGeneralSettingMock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'));
    renderPage();

    await user.click(within(card('پنجره اصلاح فاکتور')).getByRole('button', { name: 'تغییر پنجره اصلاح فاکتور' }));
    await user.click(screen.getByLabelText('پنجره اصلاح فاکتور جدید (دقیقه)'));
    await user.click(screen.getByRole('button', { name: 'رقم ۰' }));
    await user.click(screen.getByRole('button', { name: 'ذخیره نسخه جدید' }));

    expect(await screen.findByText('اجازه انجام این عملیات را ندارید')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ذخیره نسخه جدید' })).toBeInTheDocument();
  });

  it('shows loading and a retryable error', async () => {
    useGeneralSettingsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <GeneralSettingsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('در حال دریافت تنظیمات')).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    useGeneralSettingsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
