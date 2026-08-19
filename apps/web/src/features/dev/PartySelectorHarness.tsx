import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PartySelector, type PartySelection } from '@/components/common/PartySelector';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';

/**
 * هارنس انتخاب‌گر طرف حساب — **فقط توسعه**.
 *
 * `PartySelector` (FE-035) هنوز هیچ مصرف‌کننده‌ی واقعی‌ای ندارد — فرم‌های
 * فروش/خرید/تسویه که قرار است از آن استفاده کنند همه کارهای بعدی هستند
 * (FE-041 به بعد). بدون این صفحه، «تمام است وقتی» این تسک (کیبورد، لمس،
 * Bottom Sheet زیر ۶۴۰px، انتخاب خودکار بعد از ایجاد) فقط ادعاست — دقیقاً
 * همان دلیلی که `KeypadHarness.tsx` برای کیپد عددی ساخته شد.
 */
export default function PartySelectorHarness() {
  const [selected, setSelected] = useState<PartySelection | null>(null);
  const recent = useRecentPartiesStore((s) => s.recent);
  const clearRecent = useRecentPartiesStore((s) => s.clear);

  return (
    <div className="space-y-4 p-4 pb-96">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">هارنس انتخاب‌گر طرف حساب</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/">خانه</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        این صفحه فقط در توسعه وجود دارد. با کیبورد (Tab برای باز کردن، تایپ برای جست‌وجو، فلش
        بالا/پایین برای حرکت، Enter برای انتخاب) و با لمس روی موبایل (زیر ۶۴۰px باید Bottom Sheet
        تمام‌صفحه باز شود) امتحان کنید. سپس «ایجاد شخص جدید» را بزنید و مطمئن شوید همان شخص
        بلافاصله انتخاب می‌شود.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">فرم نمونه</CardTitle>
        </CardHeader>
        <CardContent>
          <PartySelector label="طرف حساب" value={selected} onChange={setSelected} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">مقدار فعلی</CardTitle>
        </CardHeader>
        <CardContent>
          {selected ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">نام</dt>
                <dd>{selected.displayName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">شناسه</dt>
                <dd className="tabular-nums" dir="ltr">
                  {selected.id}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">موبایل</dt>
                <dd className="tabular-nums" dir="ltr">
                  {selected.mobile ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">وضعیت</dt>
                <dd>
                  <Badge variant={selected.status === 'ACTIVE' ? 'outline' : 'secondary'}>
                    {selected.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                  </Badge>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">هیچ‌کس انتخاب نشده — مقدار null است.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm">فهرست اخیر ({recent.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={clearRecent} disabled={recent.length === 0}>
            <Trash2 aria-hidden="true" />
            پاک‌کردن اخیر
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {recent.length === 0 ? (
            <p className="text-muted-foreground">خالی — یک شخص انتخاب کنید تا اینجا اضافه شود.</p>
          ) : (
            recent.map((p) => (
              <div key={p.id} className="flex justify-between gap-3">
                <span>{p.displayName}</span>
                {p.status === 'INACTIVE' ? <Badge variant="secondary">غیرفعال</Badge> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
