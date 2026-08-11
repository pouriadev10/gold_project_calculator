import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/api/api-error';
import { ApiErrorNotice, ApiFieldError } from './ApiErrorNotice';

describe('ApiErrorNotice', () => {
  it('خطای شبکه را به‌صورت اعلان ماندگار و قابل‌دسترس نشان می‌دهد', () => {
    render(<ApiErrorNotice error={new NetworkError()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('ارتباط با سرور برقرار نشد');
    expect(screen.getByText('اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.')).toBeInTheDocument();
  });

  it('شناسه رهگیری را در جزئیات خطا نمایش می‌دهد', () => {
    render(<ApiErrorNotice error={new ApiError(409, 'CONFLICT', 'raw', {}, 'req-42')} />);

    expect(screen.getByText('جزئیات برای پشتیبانی')).toBeInTheDocument();
    expect(screen.getByText('req-42')).toHaveAttribute('dir', 'ltr');
  });
});

describe('ApiFieldError', () => {
  it('خطای اعتبارسنجی را کنار فیلد به‌صورت قابل‌دسترس نمایش می‌دهد', () => {
    render(<ApiFieldError messages={['وزن الزامی است']} />);

    expect(screen.getByRole('alert')).toHaveTextContent('وزن الزامی است');
  });

  it('بدون خطا چیزی رندر نمی‌کند', () => {
    const { container } = render(<ApiFieldError messages={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
