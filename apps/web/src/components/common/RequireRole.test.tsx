import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session-store';
import { RequireRole } from './RequireRole';

const sessionWithRole = (role: 'OWNER' | 'MANAGER' | 'CASHIER') => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'x@example.com', displayName: 'کاربر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role,
});

beforeEach(() => {
  useSessionStore.setState({ session: null });
});

describe('RequireRole — FE-028', () => {
  it('نقش مجاز: فرزندان رندر می‌شوند', () => {
    useSessionStore.setState({ session: sessionWithRole('OWNER') });
    render(
      <RequireRole roles={['OWNER', 'MANAGER']}>
        <p>محتوای حساس</p>
      </RequireRole>,
    );
    expect(screen.getByText('محتوای حساس')).toBeInTheDocument();
  });

  it('نقش غیرمجاز: چیزی رندر نمی‌شود — نه یک placeholder، کاملاً پنهان', () => {
    useSessionStore.setState({ session: sessionWithRole('CASHIER') });
    const { container } = render(
      <RequireRole roles={['OWNER', 'MANAGER']}>
        <p>محتوای حساس</p>
      </RequireRole>,
    );
    expect(screen.queryByText('محتوای حساس')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('بدون نشست: چیزی رندر نمی‌شود', () => {
    render(
      <RequireRole roles={['OWNER', 'MANAGER', 'CASHIER']}>
        <p>محتوای حساس</p>
      </RequireRole>,
    );
    expect(screen.queryByText('محتوای حساس')).not.toBeInTheDocument();
  });
});
