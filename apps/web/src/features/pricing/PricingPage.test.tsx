import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session-store';
import PricingPage from './PricingPage';

/**
 * FE-030 — دسترسی فرم ثبت مظنه در سطح صفحه.
 *
 * برخلاف `/reporting/profit` (که کل مسیر را با `beforeLoad` نقش‌محور
 * می‌بندد)، `/pricing` برای هر نقشی باز می‌ماند — `RolesGuard` سمت سرور
 * فقط روی `POST .../manual` نشسته، نه روی خواندن. پس اینجا فقط رندر
 * شرطی خودِ فرم را می‌سنجیم، نه یک route guard.
 */
const sessionWithRole = (role: 'OWNER' | 'MANAGER' | 'CASHIER') => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'x@example.com', displayName: 'کاربر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role,
});

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PricingPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSessionStore.setState({ session: sessionWithRole('OWNER') });
});

describe('PricingPage — عنوان', () => {
  it('عنوان «مظنه» را نشان می‌دهد', () => {
    renderPage();
    expect(screen.getByText('مظنه')).toBeInTheDocument();
  });
});

describe('PricingPage — دسترسی نقش‌محور به فرم ثبت دستی', () => {
  it('برای OWNER فرم ثبت را نشان می‌دهد', () => {
    useSessionStore.setState({ session: sessionWithRole('OWNER') });
    renderPage();
    expect(screen.getByLabelText('مظنه مثقال')).toBeInTheDocument();
  });

  it('برای MANAGER فرم ثبت را نشان می‌دهد', () => {
    useSessionStore.setState({ session: sessionWithRole('MANAGER') });
    renderPage();
    expect(screen.getByLabelText('مظنه مثقال')).toBeInTheDocument();
  });

  it('برای CASHIER فرم را پنهان و پیام دسترسی محدود را نشان می‌دهد — همان نقش‌هایی که POST /pricing/quotes/manual اجازه می‌دهد', () => {
    useSessionStore.setState({ session: sessionWithRole('CASHIER') });
    renderPage();
    expect(screen.queryByLabelText('مظنه مثقال')).not.toBeInTheDocument();
    expect(screen.getByText('دسترسی محدود')).toBeInTheDocument();
  });
});
