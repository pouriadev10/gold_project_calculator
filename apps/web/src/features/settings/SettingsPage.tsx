import { Link } from '@tanstack/react-router';
import { CircleDollarSign, ClipboardList, Coins, LogOut, Palette, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireRole } from '@/components/common/RequireRole';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLogout } from '@/hooks/useLogout';
import { OPENING_BALANCE_ROLES } from '@/lib/permissions';
import { useSessionStore } from '@/stores/session-store';

/**
 * تنظیمات — صفحه‌ی «بیشتر».
 *
 * واحد نمایش و پوسته (تنظیم این دستگاه)، به‌علاوه‌ی لینک تنظیمات عمومی
 * نسخه‌دار مستأجر (FE-080، `/settings/general`) و انواع سکه (FE-081،
 * `/settings/coin-types`) و مظنه و منابع (FE-082، همان `/pricing`).
 */

function SettingRow({
  icon: Icon,
  title,
  hint,
  control,
}: {
  icon: typeof Coins;
  title: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
        {control}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const session = useSessionStore((state) => state.session);
  const { logout, isLoggingOut } = useLogout();

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="بیشتر" />

      <div className="space-y-4 p-4">
        <SettingRow
          icon={Coins}
          title="واحد نمایش"
          hint="واحد پایه‌ی حسابداری در این صنف طلاست. ریال واحد گذراست."
          control={<UnitToggle />}
        />

        <SettingRow
          icon={Palette}
          title="پوسته"
          hint="«سیستم» از تنظیم روشن/تیره‌ی خود دستگاه پیروی می‌کند."
          control={<ThemeToggle />}
        />

        <SettingRow
          icon={SlidersHorizontal}
          title="تنظیمات عمومی"
          hint="عیار پیش‌فرض خرید، گرد کردن، عیار گزارش و قواعد اصلاح فاکتور — نسخه‌دار."
          control={
            <Button type="button" variant="outline" asChild>
              <Link to="/settings/general">مشاهده</Link>
            </Button>
          }
        />

        <SettingRow
          icon={CircleDollarSign}
          title="انواع سکه"
          hint="وزن، عیار، ضرب بانک مرکزی و فعال بودن هر نوع سکه — نسخه‌دار."
          control={
            <Button type="button" variant="outline" asChild>
              <Link to="/settings/coin-types">مشاهده</Link>
            </Button>
          }
        />

        <SettingRow
          icon={TrendingUp}
          title="مظنه و منابع"
          hint="منبع فعال مظنه، وضعیت فید، fallback و ثبت دستی."
          control={
            <Button type="button" variant="outline" asChild>
              <Link to="/pricing">مشاهده</Link>
            </Button>
          }
        />

        <RequireRole roles={OPENING_BALANCE_ROLES}>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <ClipboardList className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-medium">موجودی افتتاحیه</p>
                  <p className="text-xs text-muted-foreground">
                    ثبت اولین موجودی تنظیم می‌شود — یک‌بارمصرف و غیرقابل‌ویرایش.
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" asChild>
                <Link to="/inventory/opening-balance">ثبت</Link>
              </Button>
            </CardContent>
          </Card>
        </RequireRole>

        {session ? (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{session.user.displayName}</p>
                <p className="text-xs text-muted-foreground">{session.tenant.name}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void logout()}
                disabled={isLoggingOut}
              >
                <LogOut className="size-4" aria-hidden="true" />
                خروج
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <p className="px-1 text-xs text-muted-foreground">
          تنظیمات مالیات و پشتیبان‌گیری در گام‌های بعد به همین صفحه اضافه می‌شوند.
        </p>
      </div>
    </div>
  );
}
