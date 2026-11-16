import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { consumeDeliberateLogoutFlag, useSessionStore } from '@/stores/session-store';
import { SettingsPage } from './SettingsPage';

const logoutMock = vi.fn();
vi.mock('@/api/auth', () => ({ logout: (...args: unknown[]) => logoutMock(...args) }));

/** `Link` واقعی به `RouterProvider` نیاز دارد — همان جایگزینی `PartyList.test.tsx`. */
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

const SESSION = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran', status: 'ACTIVE' as const },
  role: 'OWNER' as const,
};

beforeEach(() => {
  logoutMock.mockReset();
  useSessionStore.setState({ session: null });
  consumeDeliberateLogoutFlag();
});

describe('SettingsPage — بخش خروج (FE-027)', () => {
  it('بدون نشست، دکمه‌ی خروج نمایش داده نمی‌شود', () => {
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: 'خروج' })).not.toBeInTheDocument();
  });

  it('با نشست فعال، نام کاربر و دکمه‌ی خروج نمایش داده می‌شود', () => {
    useSessionStore.setState({ session: SESSION });
    render(<SettingsPage />);

    expect(screen.getByText('مدیر فروشگاه')).toBeInTheDocument();
    expect(screen.getByText('زرگری نمونه')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'خروج' })).toBeInTheDocument();
  });

  it('کلیک روی خروج، سرور را با توکن تمدید صدا می‌زند و نشست را پاک می‌کند', async () => {
    useSessionStore.setState({ session: SESSION });
    logoutMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: 'خروج' }));

    expect(logoutMock).toHaveBeenCalledWith('r');
    expect(useSessionStore.getState().session).toBeNull();
  });
});

describe('SettingsPage — خروجی کامل داده (D-03)', () => {
  it('مالک لینک صفحه‌ی خروجی را می‌بیند', () => {
    useSessionStore.setState({ session: SESSION });
    render(<SettingsPage />);

    expect(screen.getByText('خروجی کامل داده')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'مشاهده' }).map((link) => link.getAttribute('href'))).toContain(
      '/settings/export',
    );
  });

  it('مدیر آن را نمی‌بیند — سرور هم فقط OWNER را می‌پذیرد', () => {
    useSessionStore.setState({ session: { ...SESSION, role: 'MANAGER' } });
    render(<SettingsPage />);

    expect(screen.queryByText('خروجی کامل داده')).not.toBeInTheDocument();
  });
});
