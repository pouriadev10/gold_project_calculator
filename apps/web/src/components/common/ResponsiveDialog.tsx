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

function ResponsiveDialog({ open, defaultOpen, onOpenChange, children }: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const variant: Variant = isDesktop ? 'dialog' : 'sheet';
  const Root = isDesktop ? Dialog : Drawer;

  // با exactOptionalPropertyTypes، پاس‌دادن صریح `undefined` با نبودِ کلید
  // یکی نیست — پس کلیدهای تعریف‌نشده اصلاً spread نمی‌شوند.
  const rootProps = {
    ...(open !== undefined && { open }),
    ...(defaultOpen !== undefined && { defaultOpen }),
    ...(onOpenChange !== undefined && { onOpenChange }),
  };

  return (
    <VariantContext.Provider value={variant}>
      <Root {...rootProps}>{children}</Root>
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
        <DrawerContent className="mt-0 h-dvh max-h-dvh rounded-t-xl border-none p-0">
          <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto p-4 pb-safe', className)}>
            {children}
          </div>
        </DrawerContent>
      );
    }

    return (
      <DialogContent className="flex max-h-[85vh] flex-col p-0">
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
