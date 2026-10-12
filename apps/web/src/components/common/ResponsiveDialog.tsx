import * as React from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isKeypadTarget } from '@/components/keypad/NumericKeypad';
import { cn } from '@/lib/utils';

/**
 * abstraction مشترک مودال — «زیر ۶۴۰px همه‌ی مودال‌ها Bottom Sheet
 * تمام‌صفحه» (بخش ۶ CLAUDE.md، بخش ۴ design-system/MASTER.md). خودِ این
 * کامپوننت تصمیم می‌گیرد کدام primitive را رندر کند؛ Featureها فقط با
 * یک API کار می‌کنند و هرگز مستقیم بین `Dialog` و `Drawer` انتخاب نمی‌کنند.
 *
 * هر دو primitive زیرین (`@radix-ui/react-dialog`، و `vaul` که خودش روی
 * همان پکیج ساخته شده) focus trap، بستن با Escape و بازگردانی فوکوس بعد
 * از بسته‌شدن را رایگان می‌دهند — این abstraction فقط انتخاب می‌کند
 * *کدام* primitive رندر شود، بدون بازسازی آن رفتارها.
 */

// باید با tailwind.config.ts → theme.screens.sm هم‌راستا بماند
const DESKTOP_QUERY = '(min-width: 640px)';

type Variant = 'dialog' | 'sheet';

const VariantContext = React.createContext<Variant>('dialog');

function useVariant(): Variant {
  return React.useContext(VariantContext);
}

interface ResponsiveDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

/**
 * FE-089 — باز و بسته شدن پس از رنگ بعدی.
 *
 * mount محتوای مودال، focus trap و قفل اسکرول Radix/vaul و خواندن استایل انیمیشن
 * (`Presence`) روی CPU ×۴ حدود ۲۰۰ms کار همگام بود که داخل همان ضربه اجرا می‌شد —
 * یعنی INP خودِ دکمه‌ای که مودال را باز می‌کرد (ممیزی `audit:inp`). اینجا وضعیت
 * درخواستی (`open` یا state داخلی) فوراً ثبت می‌شود ولی primitive با
 * `useDeferredValue` یک رندر بعد می‌رسد: ضربه اول رنگ می‌گیرد و mount در رندر
 * قابل‌وقفه‌ی بعدی انجام می‌شود. برای کاربر همان یک فریم است؛ برای INP تفاوت
 * «کل کار مودال» با «فقط state دکمه» است.
 *
 * حالت بدون کنترل (`defaultOpen` + Trigger) هم state داخلی دارد تا همین مسیر را برود.
 */
function ResponsiveDialog({ open, defaultOpen, onOpenChange, children }: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const variant: Variant = isDesktop ? 'dialog' : 'sheet';
  const Root = isDesktop ? Dialog : Drawer;

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const requestedOpen = open ?? uncontrolledOpen;
  const renderedOpen = React.useDeferredValue(requestedOpen);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (open === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );

  return (
    <VariantContext.Provider value={variant}>
      <Root open={renderedOpen} onOpenChange={handleOpenChange}>
        {children}
      </Root>
    </VariantContext.Provider>
  );
}

const ResponsiveDialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogTrigger>
>((props, ref) => {
  const Comp = useVariant() === 'dialog' ? DialogTrigger : DrawerTrigger;
  return <Comp ref={ref} {...props} />;
});
ResponsiveDialogTrigger.displayName = 'ResponsiveDialogTrigger';

const ResponsiveDialogClose = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogClose>
>((props, ref) => {
  const Comp = useVariant() === 'dialog' ? DialogClose : DrawerClose;
  return <Comp ref={ref} {...props} />;
});
ResponsiveDialogClose.displayName = 'ResponsiveDialogClose';

const ResponsiveDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof DialogTitle>
>((props, ref) => {
  const Comp = useVariant() === 'dialog' ? DialogTitle : DrawerTitle;
  return <Comp ref={ref} {...props} />;
});
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle';

const ResponsiveDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof DialogDescription>
>((props, ref) => {
  const Comp = useVariant() === 'dialog' ? DialogDescription : DrawerDescription;
  return <Comp ref={ref} {...props} />;
});
ResponsiveDialogDescription.displayName = 'ResponsiveDialogDescription';

function ResponsiveDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const Comp = useVariant() === 'dialog' ? DialogHeader : DrawerHeader;
  return <Comp className={className} {...props} />;
}
ResponsiveDialogHeader.displayName = 'ResponsiveDialogHeader';

function ResponsiveDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const Comp = useVariant() === 'dialog' ? DialogFooter : DrawerFooter;
  return <Comp className={className} {...props} />;
}
ResponsiveDialogFooter.displayName = 'ResponsiveDialogFooter';

interface ResponsiveDialogContentProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * `NumericKeypad` یک نمونه‌ی سراسری بیرون از این گفت‌وگو رندر می‌شود
 * (`NumericKeypad.tsx`، مستندات همان‌جا). بدون این استثنا، Radix/vaul با
 * `modal` پیش‌فرض ضربه روی کیپد را «کلیک بیرون از محتوا» حساب می‌کنند و
 * گفت‌وگو را می‌بندند — یعنی هر فیلد عددی داخل هر گفت‌وگویی با اولین ضربه
 * روی کیپد بسته می‌شد (و state فرم مصرف‌کننده‌اش، اگر مثل
 * `JewelryItemFormDialog` روی close پاک می‌شود، از دست می‌رفت).
 */
function ignoreKeypadOutsideInteraction(event: { detail: { originalEvent: Event }; preventDefault: () => void }) {
  if (isKeypadTarget(event.detail.originalEvent.target)) event.preventDefault();
}

/**
 * FE-084: `vaul` (از ۱.۰) فوکوس خودکار هنگام باز شدن را پیش‌فرض خاموش می‌کند تا
 * کیبورد سیستم روی موبایل ناخواسته بالا نیاید — ولی نتیجه این بود که فوکوس روی
 * دکمه‌ی پشت Bottom Sheet مودال می‌ماند و کاربر صفحه‌خوان/کیبورد داخل گفت‌وگو
 * نبود. اینجا فوکوس به خودِ ظرف sheet (`tabIndex=-1` از FocusScope رادیکس) می‌رود:
 * داخل مودال، بدون باز کردن کیبورد. اگر محتوا خودش فیلدی را فوکوس کرده، دست نمی‌خورد.
 */
function focusSheetContainer(event: Event) {
  event.preventDefault();
  const container = event.target;
  if (container instanceof HTMLElement && !container.contains(document.activeElement)) {
    container.focus({ preventScroll: true });
  }
}

/**
 * بدنه‌ی محتوا. اسکرول داخلی مستقل از صفحه‌ی پس‌زمینه است: خودِ
 * Radix/vaul صفحه‌ی پشت را قفل می‌کند، این wrapper فقط مطمئن می‌شود
 * محتوای بلند به‌جای هل‌دادن کل مودال بیرون از دید، در همان کادر اسکرول
 * بخورد. دکمه‌ی بستن سیبلینگ همین ناحیه‌ی اسکرول است نه داخلش، پس هنگام
 * اسکرول محتوا جابه‌جا نمی‌شود.
 *
 * روی موبایل ارتفاع کامل صفحه (`h-dvh`) است — طبق قاعده‌ی «بدون استثنا»ی
 * Bottom Sheet تمام‌صفحه؛ روی دسکتاپ محدود به `85vh` تا روی صفحه‌های کوتاه
 * هم از بالای نما بیرون نزند.
 */
const ResponsiveDialogContent = React.forwardRef<HTMLDivElement, ResponsiveDialogContentProps>(
  ({ className, children }, ref) => {
    const variant = useVariant();

    if (variant === 'sheet') {
      return (
        <DrawerContent
          className="mt-0 h-dvh max-h-dvh rounded-t-xl border-none p-0"
          onInteractOutside={ignoreKeypadOutsideInteraction}
          onOpenAutoFocus={focusSheetContainer}
        >
          <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto p-4 pb-safe', className)}>
            {children}
          </div>
        </DrawerContent>
      );
    }

    return (
      <DialogContent className="flex max-h-[85vh] flex-col p-0" onInteractOutside={ignoreKeypadOutsideInteraction}>
        <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto p-6', className)}>
          {children}
        </div>
      </DialogContent>
    );
  },
);
ResponsiveDialogContent.displayName = 'ResponsiveDialogContent';

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
};
