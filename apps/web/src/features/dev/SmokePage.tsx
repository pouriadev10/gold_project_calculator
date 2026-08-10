import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format as jalaliFormat } from 'date-fns-jalali';
import Dexie, { type EntityTable } from 'dexie';
import * as echarts from 'echarts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { create } from 'zustand';
import { formatGram, formatRial, searchKey } from '@gold/core-calc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { formatJalaliFullDate } from '@/lib/date';

/**
 * صفحه‌ی دود — **فقط در حالت توسعه**.
 *
 * هدفش زیبایی نیست؛ ثابت‌کردن این است که هر پکیج استک واقعاً کار می‌کند.
 * در بیلد production این ماژول اصلاً وارد درخت وابستگی نمی‌شود
 * (به `src/app/router.tsx` نگاه کن).
 */

function Section({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Badge variant="secondary">{status}</Badge>
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

/* ── Zustand ──────────────────────────────────────────────── */
const useCounter = create<{ count: number; inc: () => void }>((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

/* ── Dexie ────────────────────────────────────────────────── */
interface SmokeRow {
  id: number;
  label: string;
}
const db = new Dexie('smoke-db') as Dexie & { rows: EntityTable<SmokeRow, 'id'> };
db.version(1).stores({ rows: '++id, label' });

/* ── react-hook-form + zod ────────────────────────────────── */
const schema = z.object({
  name: z.string().min(3, 'نام باید حداقل ۳ نویسه باشد'),
});
type FormValues = z.infer<typeof schema>;

export default function SmokePage() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">صفحه‌ی دود</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/">بازگشت به خانه</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        این صفحه فقط در حالت توسعه وجود دارد و در بیلد production حذف می‌شود.
      </p>

      <TailwindRtlCheck />
      <ShadcnCheck />
      <RouterCheck />
      <QueryCheck />
      <ZustandCheck />
      <FormCheck />
      <TableCheck />
      <ChartCheck />
      <JalaliCheck />
      <DexieCheck />
      <PwaCheck />
      <FontCheck />
    </div>
  );
}

function TailwindRtlCheck() {
  return (
    <Section title="Tailwind + RTL" status="ms-/me- منطقی">
      <div className="flex items-center">
        <span className="rounded bg-primary px-2 py-1 text-primary-foreground">مبدأ</span>
        <span className="ms-4 rounded bg-muted px-2 py-1">
          این کادر با <code>ms-4</code> فاصله گرفته — در RTL باید سمت چپ باشد
        </span>
      </div>
    </Section>
  );
}

function ShadcnCheck() {
  return (
    <Section title="shadcn/ui" status="Button + Dialog">
      <Dialog>
        <DialogTrigger asChild>
          <Button>باز کردن گفت‌وگو</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>گفت‌وگوی آزمایشی</DialogTitle>
            <DialogDescription>
              دکمه‌ی بستن باید در گوشه‌ی چپ‌بالا باشد، چون <code>end-4</code> در RTL چپ است.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function RouterCheck() {
  return (
    <Section title="TanStack Router" status="دو مسیر">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/">خانه</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/parties">اشخاص</Link>
        </Button>
      </div>
    </Section>
  );
}

function QueryCheck() {
  const ok = useQuery({
    queryKey: ['smoke-ok'],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 400));
      return 'داده با موفقیت دریافت شد';
    },
  });

  const failing = useQuery({
    queryKey: ['smoke-fail'],
    retry: false,
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 400));
      throw new Error('خطای عمدی برای آزمون حالت خطا');
    },
  });

  return (
    <Section title="TanStack Query" status="loading + error">
      <p>{ok.isLoading ? 'در حال بارگذاری…' : (ok.data ?? '—')}</p>
      <Separator className="my-2" />
      <p className="text-destructive">
        {failing.isLoading
          ? 'در حال بارگذاری…'
          : failing.error instanceof Error
            ? failing.error.message
            : '—'}
      </p>
    </Section>
  );
}

function ZustandCheck() {
  const { count, inc } = useCounter();
  return (
    <Section title="Zustand" status="استور کوچک">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={inc}>
          افزایش
        </Button>
        <span className="tabular-nums">مقدار: {count}</span>
      </div>
    </Section>
  );
}

function FormCheck() {
  const [submitted, setSubmitted] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '' } });

  return (
    <Section title="react-hook-form + zod" status="اعتبارسنجی">
      <form
        className="space-y-2"
        onSubmit={handleSubmit((values) => setSubmitted(searchKey(values.name)))}
        noValidate
      >
        <Input
          {...register('name')}
          placeholder="نام مشتری"
          aria-invalid={Boolean(errors.name)}
          autoCorrect="off"
          autoCapitalize="off"
        />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
        <Button type="submit" size="sm">
          ثبت
        </Button>
        {submitted ? <p className="text-xs text-muted-foreground">کلید جست‌وجو: {submitted}</p> : null}
      </form>
    </Section>
  );
}

function TableCheck() {
  const data = useMemo(
    () =>
      Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        weightMg: BigInt((i + 1) * 137),
        rial: BigInt((i + 1) * 1_250_000),
      })),
    [],
  );

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(
    () => [
      { accessorKey: 'id', header: 'ردیف' },
      { id: 'weight', header: 'وزن', cell: (c) => formatGram(c.row.original.weightMg) },
      { id: 'rial', header: 'مبلغ', cell: (c) => formatRial(c.row.original.rial) },
    ],
    [],
  );

  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  return (
    <Section title="TanStack Table + Virtual" status="۱۰۰۰ ردیف">
      <div ref={scrollRef} className="h-64 overflow-auto rounded-md border border-border">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                className="absolute inset-x-0 flex items-center gap-4 border-b border-border px-3 tabular-nums"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.getVisibleCells().map((cell) => (
                  <span key={cell.id} className="flex-1 truncate text-xs">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/**
 * ECharts مستقیم، نه از طریق `echarts-for-react`.
 *
 * آن wrapper با StrictMode ری‌اکت ۱۸ سازگار نیست: در چرخه‌ی
 * mount → cleanup → mount، متد `dispose` بوم را برمی‌دارد ولی صفت
 * `_echarts_instance_` روی عنصر می‌ماند، و mount دوم فکر می‌کند نمودار
 * از قبل ساخته شده. نتیجه یک `div` خالی است، بدون هیچ خطای کنسولی.
 *
 * استفاده‌ی مستقیم هم این باگ را ندارد، هم کنترل بیشتری روی حجم بسته
 * می‌دهد — و ECharts در فاز ۱ فقط در گزارش‌ها لازم است.
 */
function ChartCheck() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // رنگ از توکن‌های CSS خوانده می‌شود، نه hex خام در کد
    const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.setOption({
      grid: { top: 20, right: 40, bottom: 24, left: 10 },
      xAxis: {
        type: 'category',
        data: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر'],
        // محور از راست به چپ خوانده می‌شود
        inverse: true,
      },
      yAxis: { type: 'value', position: 'right' },
      series: [{ type: 'bar', data: [120, 200, 150, 260], itemStyle: { color: `hsl(${primary})` } }],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, []);

  return (
    <Section title="ECharts" status="نمودار RTL">
      <div ref={containerRef} className="h-[200px] w-full" />
    </Section>
  );
}

/**
 * هر دو مسیر تاریخ آزموده می‌شوند:
 *
 * - `date-fns-jalali` — پکیجی که BOOTSTRAP خواسته نصب و تأیید شود.
 * - `Intl` بومی — همان چیزی که در production واقعاً استفاده می‌شود.
 *
 * production از Intl استفاده می‌کند چون هم ارقام را فارسی می‌دهد (کاری که
 * date-fns-jalali نمی‌کند) و هم صفر بایت به مسیر بحرانی اضافه می‌کند.
 */
function JalaliCheck() {
  const now = new Date();
  return (
    <Section title="date-fns-jalali" status="تاریخ شمسی">
      <p className="tabular-nums">
        <span className="text-muted-foreground">date-fns-jalali: </span>
        {jalaliFormat(now, 'EEEE d MMMM yyyy')}
      </p>
      <p className="tabular-nums">
        <span className="text-muted-foreground">Intl بومی (production): </span>
        {formatJalaliFullDate(now)}
      </p>
    </Section>
  );
}

function DexieCheck() {
  const [state, setState] = useState('در حال آزمون…');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await db.rows.clear();
        const id = await db.rows.add({ label: 'رکورد آزمایشی' } as SmokeRow);
        const found = await db.rows.get(id);
        if (!cancelled) setState(found ? `نوشته و خوانده شد: ${found.label}` : 'خواندن ناموفق');
      } catch (error) {
        if (!cancelled) setState(error instanceof Error ? error.message : 'خطای ناشناخته');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section title="Dexie" status="read/write">
      <p>{state}</p>
    </Section>
  );
}

function PwaCheck() {
  const [state, setState] = useState('در حال بررسی…');

  useEffect(() => {
    let cancelled = false;
    // این‌جا عمداً fetch خام است: دارد وجود خودِ manifest استاتیک را آزمایش
    // می‌کند، نه یک endpoint REST — از api/client عبور کردنش معنا ندارد.
    // eslint-disable-next-line no-restricted-globals -- آزمون مستقیم فایل استاتیک PWA، نه فراخوانی API
    void fetch('/manifest.webmanifest')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('manifest پیدا نشد'))))
      .then((m: { name?: string; dir?: string }) => {
        if (!cancelled) setState(`manifest: ${m.name ?? '—'} · dir=${m.dir ?? '—'}`);
      })
      .catch((e: Error) => {
        if (!cancelled) setState(`${e.message} — در dev طبیعی است، در بیلد باید موجود باشد`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section title="vite-plugin-pwa" status="manifest">
      <p className="text-xs">{state}</p>
    </Section>
  );
}

function FontCheck() {
  return (
    <Section title="وزیرمتن" status="tabular numbers">
      <p>حروف فارسی: گچپژ آی‌کیو — نیم‌فاصله: می‌شود</p>
      <p className="tabular-nums">۱۱۱۱۱۱ ارقام جدولی</p>
      <p className="tabular-nums">۸۸۸۸۸۸ باید هم‌عرض بالا باشد</p>
    </Section>
  );
}
