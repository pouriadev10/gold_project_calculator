import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** صفحه‌ی ۴۰۴ — بدون فرض روی اینکه پوسته‌ی برنامه (ناوبری) در دسترس است. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Compass className="size-7" />
      </span>
      <div>
        <p className="text-base font-bold">این صفحه پیدا نشد</p>
        <p className="mt-1 text-sm text-muted-foreground">نشانی وارد شده در برنامه وجود ندارد.</p>
      </div>
      <Button asChild size="action">
        <Link to="/dashboard">بازگشت به داشبورد</Link>
      </Button>
    </div>
  );
}
