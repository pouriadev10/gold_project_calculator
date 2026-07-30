import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * اندازه‌ها با قاعده‌ی ۶ BOOTSTRAP هم‌تراز شده‌اند:
 * **هیچ هدف لمسی زیر ۴۴×۴۴ پیکسل نیست، بدون استثنا.**
 *
 * مقادیر پیش‌فرض shadcn (۳۶/۳۲/۴۰ پیکسل) هر سه زیر این حد بودند.
 * `sm` هم ۴۴ پیکسل ارتفاع دارد؛ کوچکی‌اش از فاصله و اندازه‌ی قلم می‌آید،
 * نه از کوچک‌کردن ناحیه‌ی لمس.
 */
const buttonVariants = cva(
  "inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90 active:bg-primary/80",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:bg-secondary/70",
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        link: "text-primary underline underline-offset-4",
      },
      size: {
        default: "min-h-touch px-4 py-2",
        sm: "min-h-touch rounded-md px-3 text-xs",
        lg: "min-h-action rounded-lg px-8 text-base",
        icon: "size-touch",
        /** اقدام اصلی صفحه — یک‌سوم پایین، ارتفاع ۵۶ پیکسل */
        action: "min-h-action w-full rounded-lg px-6 text-base font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
