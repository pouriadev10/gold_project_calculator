import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Queries from '@/api/queries';
import { CoinName } from './CoinName';

const useCoinTypesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypes: (...args: unknown[]) => useCoinTypesMock(...args),
}));

const BAHAR_ID = 'c3000000-0000-4000-8000-000000000001';

beforeEach(() => {
  useCoinTypesMock.mockReset();
});

describe('CoinName — عنوان فارسی به‌جای کد (M-28، #27)', () => {
  it('عنوان نسخه‌ی مؤثر نوع را نشان می‌دهد و کد را در title نگه می‌دارد', () => {
    useCoinTypesMock.mockReturnValue({ data: [{ coinTypeId: BAHAR_ID, code: 'BAHAR_AZADI_NEW', title: 'تمام بهار آزادی' }] });
    render(<CoinName coinTypeId={BAHAR_ID} code="BAHAR_AZADI_NEW" />);
    const name = screen.getByText('تمام بهار آزادی');
    expect(name).toHaveAttribute('title', 'BAHAR_AZADI_NEW');
    expect(screen.queryByText('BAHAR_AZADI_NEW')).not.toBeInTheDocument();
  });

  it('تا رسیدن فهرست، یا برای نوعی که در آن نیست، کد را نشان می‌دهد', () => {
    useCoinTypesMock.mockReturnValue({ data: undefined });
    const { rerender } = render(<CoinName coinTypeId={BAHAR_ID} code="BAHAR_AZADI_NEW" />);
    expect(screen.getByText('BAHAR_AZADI_NEW')).toBeInTheDocument();

    useCoinTypesMock.mockReturnValue({ data: [] });
    rerender(<CoinName coinTypeId={BAHAR_ID} code="BAHAR_AZADI_NEW" />);
    expect(screen.getByText('BAHAR_AZADI_NEW')).not.toHaveAttribute('title');
  });
});
