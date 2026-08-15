import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from './ResponsiveDialog';

/** شبیه‌سازی `(min-width: 640px)` — `desktop=true` یعنی حالت Dialog، `false` یعنی Bottom Sheet. */
function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px') && desktop,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

function renderDialog() {
  render(
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button>باز کردن</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>عنوان آزمایشی</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>توضیح آزمایشی</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Input placeholder="نام" aria-label="نام" />
        <ResponsiveDialogFooter>
          {/* برچسب عمداً با دکمه‌ی X گوشه («بستن») فرق دارد — هر دو accessible name یکسان نباید داشته باشند */}
          <ResponsiveDialogClose asChild>
            <Button variant="outline">لغو</Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResponsiveDialog — زیر ۶۴۰px', () => {
  it('به‌صورت Bottom Sheet با drag handle باز می‌شود', async () => {
    mockViewport(false);
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'باز کردن' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-sheet-handle')).toBeInTheDocument();
    expect(screen.getByText('عنوان آزمایشی')).toBeInTheDocument();
  });
});

describe('ResponsiveDialog — از ۶۴۰px به بالا', () => {
  it('به‌صورت Dialog وسط‌چین، بدون drag handle باز می‌شود', async () => {
    mockViewport(true);
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'باز کردن' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('bottom-sheet-handle')).not.toBeInTheDocument();
    expect(screen.getByText('عنوان آزمایشی')).toBeInTheDocument();
  });
});

describe.each([
  ['Bottom Sheet (موبایل)', false],
  ['Dialog (دسکتاپ)', true],
] as const)('رفتار مشترک کیبورد و فوکوس — %s', (_label, desktop) => {
  it('فوکوس داخل مودال قفل می‌شود و فرم با کیبورد کار می‌کند', async () => {
    mockViewport(desktop);
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'باز کردن' }));
    await screen.findByRole('dialog');

    const input = screen.getByLabelText('نام');
    await user.type(input, 'علی');
    expect(input).toHaveValue('علی');
  });

  it('Escape مودال را می‌بندد و فوکوس به دکمه‌ی باز‌کننده برمی‌گردد', async () => {
    mockViewport(desktop);
    const user = userEvent.setup();
    renderDialog();

    const trigger = screen.getByRole('button', { name: 'باز کردن' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ResponsiveDialogClose سفارشی مودال را می‌بندد', async () => {
    mockViewport(desktop);
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'باز کردن' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'لغو' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('دکمه‌ی X گوشه (بستن پیش‌فرض primitive) هم مودال را می‌بندد', async () => {
    mockViewport(desktop);
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'باز کردن' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'بستن' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ResponsiveDialog — حالت کنترل‌شده', () => {
  it('open و onOpenChange بیرونی را محترم می‌شمارد', async () => {
    mockViewport(true);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            onOpenChange(next);
          }}
        >
          <ResponsiveDialogTrigger asChild>
            <Button>باز کردن</Button>
          </ResponsiveDialogTrigger>
          <ResponsiveDialogContent>
            <ResponsiveDialogTitle>عنوان</ResponsiveDialogTitle>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      );
    }

    render(<Controlled />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'باز کردن' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
