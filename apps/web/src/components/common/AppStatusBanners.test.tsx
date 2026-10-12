import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppUpdateStore } from '@/stores/app-update-store';
import { AppStatusBanners } from './AppStatusBanners';

const applyUpdate = vi.fn();
vi.mock('@/lib/pwa-update', () => ({
  applyUpdate: (worker: ServiceWorker) => applyUpdate(worker),
}));

beforeEach(() => {
  useAppUpdateStore.setState({ waiting: null, dismissed: false });
  applyUpdate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OfflineBanner — FE-090', () => {
  it('آنلاین: ناحیه‌ی زنده هست ولی پیامی ندارد', () => {
    render(<AppStatusBanners />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('قطع اینترنت پیام صریح می‌دهد و با وصل شدن می‌رود', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<AppStatusBanners />);

    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('اتصال اینترنت قطع است.');
    expect(status).toHaveTextContent('ثبت معامله و هر عملیات مالی تا وصل شدن غیرفعال است');
    expect(status).toHaveTextContent('هیچ چیزی آفلاین ذخیره یا بعداً خودکار ارسال نمی‌شود');

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('AppUpdateBanner — FE-090', () => {
  it('بدون نسخه‌ی منتظر چیزی نشان نمی‌دهد', () => {
    render(<AppStatusBanners />);
    expect(
      screen.queryByRole('region', { name: 'نسخه‌ی تازه‌ی برنامه آماده است' }),
    ).not.toBeInTheDocument();
  });

  it('«به‌روزرسانی» نسخه‌ی منتظر را فعال می‌کند — نه خودکار', async () => {
    const worker = { id: 'next' } as unknown as ServiceWorker;
    useAppUpdateStore.getState().setWaiting(worker);
    render(<AppStatusBanners />);

    const region = screen.getByRole('region', { name: 'نسخه‌ی تازه‌ی برنامه آماده است' });
    expect(region).toHaveTextContent('اگر ثبتی نیمه‌کاره دارید');
    expect(applyUpdate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'به‌روزرسانی' }));
    expect(applyUpdate).toHaveBeenCalledWith(worker);
  });

  it('«بعداً» اعلان را برای این نشست کنار می‌گذارد و نسخه‌ی تازه‌تر دوباره آن را نشان می‌دهد', async () => {
    useAppUpdateStore.getState().setWaiting({} as ServiceWorker);
    render(<AppStatusBanners />);

    await userEvent.click(screen.getByRole('button', { name: 'بعداً' }));
    expect(screen.queryByRole('button', { name: 'به‌روزرسانی' })).not.toBeInTheDocument();

    act(() => {
      useAppUpdateStore.getState().setWaiting({} as ServiceWorker);
    });
    expect(screen.getByRole('button', { name: 'به‌روزرسانی' })).toBeInTheDocument();
  });
});
