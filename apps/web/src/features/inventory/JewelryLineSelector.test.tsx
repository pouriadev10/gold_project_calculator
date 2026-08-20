import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { JewelryItemVersion } from '@/api/contracts';
import { JewelryLineSelector, type SelectedJewelryLine } from './JewelryLineSelector';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useKeypadStore } from '@/components/keypad/keypad-store';

/**
 * FE-039 — انتخاب‌گر خط‌های زیورآلات موجودی افتتاحیه.
 *
 * الگوی mock دقیقاً مثل `PartySelector.test.tsx`: `useJewelryItems`
 * مستقیم mock می‌شود، نه MSW — این تست فقط رفتار جست‌وجو+افزودن+تعداد را
 * می‌بیند، نه صحت خودِ query.
 */

const useJewelryItemsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
}));

function item(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
  return {
    id: 'v1',
    jewelryItemId: 'i1',
    code: 'BR-750-12',
    title: 'دستبند ۱۸ عیار',
    grossWeightMg: '12350',
    karat: 750,
    stoneWeightMg: '0',
    otherDeductionWeightMg: '0',
    wageType: 'PER_GRAM',
    wageValue: '3500000',
    validFrom: '2026-07-30T09:00:00+00:00',
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

function Harness({
  initialLines = [],
  disabled,
}: {
  initialLines?: SelectedJewelryLine[];
  disabled?: boolean;
}) {
  const [lines, setLines] = useState<readonly SelectedJewelryLine[]>(initialLines);
  return (
    <>
      <JewelryLineSelector lines={lines} onChange={setLines} {...(disabled !== undefined && { disabled })} />
      <NumericKeypad />
      <p data-testid="line-count">{lines.length}</p>
    </>
  );
}

function renderSelector(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

async function typeDigits(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  await user.click(screen.getByLabelText(label));
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useJewelryItemsMock.mockReset();
  useJewelryItemsMock.mockReturnValue({
    data: { items: [item(), item({ jewelryItemId: 'i2', id: 'v2', code: 'RG-750-04', title: 'انگشتر نگین‌دار' })] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('JewelryLineSelector — افزودن', () => {
  it('کلیک روی نتیجه‌ی جست‌وجو، قلم را با تعداد ۱ اضافه می‌کند', async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole('button', { name: 'افزودن کالای زیورآلات' }));
    await user.click(screen.getByText('دستبند ۱۸ عیار'));

    expect(screen.getByTestId('line-count')).toHaveTextContent('1');
    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '1');
  });

  it('قلم از‌قبل‌انتخاب‌شده دیگر در نتایج جست‌وجو نیست', async () => {
    const user = userEvent.setup();
    renderSelector({
      initialLines: [{ jewelryItemId: 'i1', code: 'BR-750-12', title: 'دستبند ۱۸ عیار', quantity: 1n }],
    });

    await user.click(screen.getByRole('button', { name: 'افزودن کالای زیورآلات' }));

    // در گفت‌وگو فقط انگشتر باید باشد؛ دستبند از قبل انتخاب شده
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('انگشتر نگین‌دار');
    expect(dialog).not.toHaveTextContent('دستبند ۱۸ عیار');
  });
});

describe('JewelryLineSelector — تعداد و حذف', () => {
  it('تغییر تعداد یک قلم انتخاب‌شده، مقدارش را به‌روزرسانی می‌کند', async () => {
    const user = userEvent.setup();
    renderSelector({
      initialLines: [{ jewelryItemId: 'i1', code: 'BR-750-12', title: 'دستبند ۱۸ عیار', quantity: 1n }],
    });

    // مقدار پیش‌فرض «۱» است — رقم تازه به بافر اضافه می‌شود، نه جایگزین؛
    // پس اول با ⌫ بافر پاک می‌شود (همان الگوی KaratInput.test.tsx)
    await user.click(screen.getByLabelText('تعداد'));
    await user.click(screen.getByRole('button', { name: 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید' }));
    await typeDigits(user, 'تعداد', '3');
    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '3');
  });

  it('تعداد صفر هشدار می‌دهد که این قلم ثبت نمی‌شود', async () => {
    renderSelector({
      initialLines: [{ jewelryItemId: 'i1', code: 'BR-750-12', title: 'دستبند ۱۸ عیار', quantity: 0n }],
    });

    expect(screen.getByText('تعداد صفر — این قلم ثبت نمی‌شود')).toBeInTheDocument();
  });

  it('دکمه‌ی حذف، قلم را از فهرست برمی‌دارد', async () => {
    const user = userEvent.setup();
    renderSelector({
      initialLines: [{ jewelryItemId: 'i1', code: 'BR-750-12', title: 'دستبند ۱۸ عیار', quantity: 2n }],
    });

    expect(screen.getByTestId('line-count')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'حذف دستبند ۱۸ عیار' }));
    await waitFor(() => expect(screen.getByTestId('line-count')).toHaveTextContent('0'));
  });
});
