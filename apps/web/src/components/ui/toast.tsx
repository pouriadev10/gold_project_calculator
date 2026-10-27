import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitive.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, label = "اعلان‌ها", ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    label={label}
    className={cn(
      /*
       * بالای صفحه، نه پایین (M-25، #39): پایینِ صفحه منطقه‌ی شست و نوار اقدام اصلی هر صفحه است
       * (بخش ۶ CLAUDE.md) و toast دقیقاً روی «بعدی»/«ثبت» می‌نشست. خود ناحیه ضربه نمی‌گیرد —
       * padding ِ خالی‌اش پیش‌تر ضربه‌ی دکمه‌ی پشتش را می‌خورد؛ فقط کارت toast می‌گیرد.
       * از sm به بالا گوشه‌ی بالا (end در RTL یعنی چپ).
       */
      "pointer-events-none fixed inset-x-0 top-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:inset-x-auto sm:top-4 sm:end-4 sm:max-w-sm sm:pt-4",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

const toastVariants = cva(
  // مدت انیمیشن (duration-200) باید با REMOVE_DELAY_MS در toast-store.ts هماهنگ بماند
  "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-4 shadow-lg transition-all duration-200 data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=closed]:slide-out-to-top-full sm:data-[state=open]:slide-in-from-top-4",
  {
    variants: {
      variant: {
        success: "border-credit/30 bg-card text-foreground",
        error: "border-destructive/40 bg-card text-foreground",
        warning: "border-warning/40 bg-card text-foreground",
        info: "border-border bg-card text-foreground",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
))
Toast.displayName = ToastPrimitive.Root.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "grid size-touch shrink-0 cursor-pointer place-items-center self-start rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="size-4" />
    <span className="sr-only">بستن</span>
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-bold", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-6 text-muted-foreground", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  toastVariants,
}
