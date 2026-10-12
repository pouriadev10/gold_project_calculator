import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { toast, useToastStore } from '@/stores/toast-store';
import { DeferredToaster } from './DeferredToaster';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('DeferredToaster', () => {
  it('toastی که پیش از آماده شدن ثبت شده گم نمی‌شود', async () => {
    // بالا آمدن برنامه هرگز تمام نمی‌شود؛ فقط خودِ toast باید چانک را بخواهد
    render(<DeferredToaster ready={new Promise(() => undefined)} />);

    act(() => {
      toast.success('فاکتور ثبت شد');
    });

    expect(await screen.findByText('فاکتور ثبت شد')).toBeInTheDocument();
  });

  it('بدون toast، رندرکننده را فقط پس از ready از پیش آماده می‌کند', async () => {
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    render(<DeferredToaster ready={ready} />);

    // پیش از پایان بالا آمدن هیچ ناحیه‌ی اعلانی ساخته نشده
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    await act(async () => {
      markReady();
      await ready;
    });

    expect(await screen.findByRole('region')).toBeInTheDocument();
  });
});
