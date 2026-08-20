import { Link } from '@tanstack/react-router';
import { ClipboardList, Coins, LogOut, Palette } from 'lucide-react';
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
 * فعلاً فقط دو تنظیم سراسری دارد: واحد نمایش و پوسته. جای بقیه‌ی
 * تنظیمات (مالیات، عیار پیش‌فرض، پشتیبان‌گیری) در فازهای بعد همین‌جاست.
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
          تنظیمات مالیات، عیار پیش‌فرض و پشتیبان‌گیری در گام‌های بعد به همین صفحه اضافه می‌شوند.
        </p>
      </div>
    </div>
  );
}
