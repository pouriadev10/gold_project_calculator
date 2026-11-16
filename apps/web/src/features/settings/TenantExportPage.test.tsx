import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type * as PdfFile from '@/lib/pdf-file';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/api-error';
import type { TenantExport } from '@/api/contracts';
import TenantExportPage from './TenantExportPage';

const createTenantExport = vi.fn();
const getTenantExportFile = vi.fn();
vi.mock('@/api/platform', () => ({
  createTenantExport: (...args: unknown[]) => createTenantExport(...args),
  getTenantExportFile: (...args: unknown[]) => getTenantExportFile(...args),
}));

const saveBlob = vi.fn();
vi.mock('@/lib/pdf-file', async (importOriginal) => ({
  ...(await importOriginal<typeof PdfFile>()),
  saveBlob: (...args: unknown[]) => saveBlob(...args),
}));

/** `Link` واقعی به `RouterProvider` نیاز دارد — همان جایگزینی `SettingsPage.test.tsx`. */
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

const EXPORT: TenantExport = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  format: 'gold-tenant-export',
  schemaVersion: 1,
  snapshotAt: '2026-11-16T08:30:00.000Z',
  createdAt: '2026-11-16T08:30:00.000Z',
  requestedBy: null,
  byteSize: 20_481,
  sha256: 'ab'.repeat(32),
  rowCounts: { parties: 2 },
};

beforeEach(() => {
  createTenantExport.mockReset();
  getTenantExportFile.mockReset();
  saveBlob.mockReset();
});

describe('TenantExportPage — D-03 / BE-069', () => {
  it('ساخت خروجی فراداده‌ی سرور را نشان می‌دهد: زمان، اندازه و اثر انگشت', async () => {
    createTenantExport.mockResolvedValue(EXPORT);
    const user = userEvent.setup();
    render(<TenantExportPage />);

    await user.click(screen.getByRole('button', { name: 'ساخت خروجی' }));

    expect(await screen.findByRole('heading', { name: 'خروجی آماده است' })).toBeInTheDocument();
    // ۲۰٬۴۸۱ بایت رو به بالا = ۲۱ کیلوبایت
    expect(screen.getByText('۲۱ کیلوبایت')).toBeInTheDocument();
    expect(screen.getByText(EXPORT.sha256)).toBeInTheDocument();
    expect(createTenantExport).toHaveBeenCalledTimes(1);
    expect(createTenantExport.mock.calls[0]?.[0]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('دریافت فایل همان خروجی را با نام سرور و پسوند json ذخیره می‌کند', async () => {
    createTenantExport.mockResolvedValue(EXPORT);
    const content = new Blob(['{}'], { type: 'application/json' });
    getTenantExportFile.mockResolvedValue({ content, fileName: 'tenant-export-demo-2026-11-16-3f2504e0.json' });
    const user = userEvent.setup();
    render(<TenantExportPage />);

    await user.click(screen.getByRole('button', { name: 'ساخت خروجی' }));
    await user.click(await screen.findByRole('button', { name: 'دریافت فایل' }));

    expect(getTenantExportFile).toHaveBeenCalledWith(EXPORT.id);
    expect(saveBlob).toHaveBeenCalledWith(content, 'tenant-export-demo-2026-11-16-3f2504e0.json');
  });

  it('شکست ساخت پیام می‌دهد و تلاش دوباره همان کلید را می‌فرستد؛ پس از موفقیت، خروجی بعدی کلید تازه دارد', async () => {
    createTenantExport
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'سرویس موقتاً در دسترس نیست'))
      .mockResolvedValue(EXPORT);
    const user = userEvent.setup();
    render(<TenantExportPage />);

    await user.click(screen.getByRole('button', { name: 'ساخت خروجی' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ساخت خروجی' }));
    await screen.findByRole('heading', { name: 'خروجی آماده است' });
    await user.click(screen.getByRole('button', { name: 'ساخت خروجی تازه' }));

    const [failedKey, retriedKey, nextKey] = createTenantExport.mock.calls.map((call) => call[0]);
    expect(retriedKey).toBe(failedKey);
    expect(nextKey).not.toBe(retriedKey);
  });
});
