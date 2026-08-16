import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * انتخاب‌گر بومی — نه `@radix-ui/react-select`. برای فیلترهای ساده (نوع،
 * وضعیت) کیبورد لمسی/سیستم‌عامل خودِ مرورگر روی موبایل تجربه‌ی بهتری از
 * یک popover دست‌ساز می‌دهد و هیچ وابستگی تازه‌ای به بودجه‌ی ۲۰۰KB اضافه
 * نمی‌کند.
 */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'flex min-h-touch w-full appearance-none rounded-md border border-input bg-transparent ps-3 pe-9 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    );
  },
);
Select.displayName = 'Select';

export { Select };
