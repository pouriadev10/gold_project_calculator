import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Loader2, Pencil } from 'lucide-react';
import { formatCount, formatKarat, toSafeNumber } from '@gold/core-calc';
import { generalSettingValueError, type GeneralSetting, type GeneralSettingKey } from '@/api/contracts';
import { useGeneralSettings } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { updateGeneralSetting } from '@/api/settings';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { CountInput } from '@/components/keypad/CountInput';
import { KaratInput } from '@/components/keypad/KaratInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useHasRole } from '@/hooks/useHasRole';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { formatJalaliDateTime } from '@/lib/date';
import { GENERAL_SETTINGS_EDIT_ROLES } from '@/lib/permissions';
import { toast } from '@/stores/toast-store';

/**
 * تنظیمات عمومی مستأجر — FE-080، روی `GET`/`POST /settings/general`.
 *
 * - **مقادیر از API:** هیچ عدد صنفی در این صفحه هاردکد نیست؛ مقدار، شماره‌ی
 *   نسخه و شروع اعتبار هر کلید از سرور می‌آید.
 * - **تغییر = نسخه‌ی تازه:** «ذخیره» یک نسخه‌ی جدید با شروع اعتبار «اکنون»
 *   می‌سازد؛ نسخه‌ی قبلی بسته می‌شود و فاکتورها و خریدهای گذشته که snapshot
 *   تنظیمات خودشان را دارند تغییر نمی‌کنند.
 * - **فقط نقش مجاز:** ویرایش فقط برای OWNER و MANAGER (آینه‌ی `@Roles` سرور)؛
 *   صندوقدار مقدارها را می‌بیند ولی دکمه‌ی تغییر ندارد.
 *
 * اعتبارسنجی هر کلید همان `generalSettingValueError` قرارداد مشترک است که
 * سرور هم اجرا می‌کند. عددها با صفحه‌کلید سفارشی وارد می‌شوند. این صفحه کلید
 * طلا/ریال ندارد: آستانه‌ها و واحد گرد کردن ذاتاً ریالی‌اند (مثل نرخ‌ها، با
 * `RateDisplay`) و تبدیلشان به گرم بی‌معناست.
 */

type SettingKind = 'karat' | 'rial' | 'minutes' | 'policy';

const SETTING_META: Record<GeneralSettingKey, { label: string; description: string; kind: SettingKind }> = {
  'purchase.second_hand_default_karat': {
    label: 'عیار پیش‌فرض خرید دست‌دوم',
    description: 'عیاری که خرید طلای دست‌دوم با آن شروع می‌شود؛ در هر خرید قابل تغییر است.',
    kind: 'karat',
  },
  'pricing.rial_rounding_unit': {
    label: 'واحد گرد کردن',
    description: 'مبلغ نهایی فاکتور و خرید فقط یک‌بار و به مضرب این مبلغ گرد می‌شود.',
    kind: 'rial',
  },
  'pricing.rounding_policy': {
    label: 'سیاست گرد کردن',
    description: 'روش گرد کردن مبلغ نهایی؛ فعلاً فقط «نیم به بالا» پشتیبانی می‌شود.',
    kind: 'policy',
  },
  'reporting.default_display_karat': {
    label: 'عیار نمایش گزارش',
    description: 'گرم‌ها در گزارش‌ها به معادل این عیار نشان داده می‌شوند.',
    kind: 'karat',
  },
  'sales.invoice_correction_window_minutes': {
    label: 'پنجره اصلاح فاکتور',
    description: 'تا چند دقیقه پس از نهایی شدن، فاکتور بدون مجوز مدیر قابل اصلاح است.',
    kind: 'minutes',
  },
  'sales.manager_approval_variance_rial': {
    label: 'حد اختلاف نیازمند مدیر',
    description: 'اصلاحی که مبلغ فاکتور را بیش از این حد تغییر دهد مجوز مدیر می‌خواهد.',
    kind: 'rial',
  },
};

const ROUNDING_POLICY_LABEL: Record<string, string> = { HALF_UP: 'نیم به بالا' };

function SettingValue({ setting }: { setting: GeneralSetting }) {
  const kind = SETTING_META[setting.key].kind;
  if (kind === 'policy') {
    return <span className="text-sm font-semibold">{ROUNDING_POLICY_LABEL[setting.value] ?? setting.value}</span>;
  }
  if (!/^\d+$/u.test(setting.value)) {
    return <span className="text-sm text-destructive">مقدار نامعتبر: {setting.value}</span>;
  }
  const value = BigInt(setting.value);
  if (kind === 'rial') return <RateDisplay value={value} size="sm" />;
  if (kind === 'karat') return <span className="tabular-nums text-sm font-semibold">{formatKarat(toSafeNumber(value))}</span>;
  return (
    <span className="tabular-nums text-sm font-semibold">
      {formatCount(toSafeNumber(value))}
      <span className="ms-1 text-xs font-normal text-muted-foreground">دقیقه</span>
    </span>
  );
}

/**
 * ویرایشگر یک کلید. فقط پس از دانستن مقدار فعلی mount می‌شود و state را
 * همگام از آن می‌سازد (باگ seed-race در `NumericField`).
 */
function SettingEditor({ setting, onDone }: { setting: GeneralSetting; onDone: () => void }) {
  const queryClient = useQueryClient();
  const meta = SETTING_META[setting.key];
  const [draft, setDraft] = useState(setting.value);
  const [error, setError] = useState<unknown>(null);
  const validation = generalSettingValueError(setting.key, draft);
  const unchanged = draft === setting.value;
  const { submit, isSubmitting } = useIdempotentSubmit((key: string, value: string) =>
    updateGeneralSetting({ key: setting.key, value }, key),
  );

  async function save(): Promise<void> {
    if (validation !== null || unchanged) return;
    setError(null);
    try {
      const updated = await submit(draft);
      if (!updated) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.general() });
      toast.success(`${meta.label} ذخیره شد`, `نسخه ${formatCount(updated.version)} از همین لحظه معتبر است.`);
      onDone();
    } catch (caught: unknown) {
      setError(caught);
    }
  }

  const bigintDraft = /^\d+$/u.test(draft) ? BigInt(draft) : 0n;
  const onNumber = (value: bigint) => setDraft(value.toString());
  const fieldError = !unchanged && validation !== null ? validation : undefined;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {meta.kind === 'karat' ? (
        <KaratInput label={`${meta.label} جدید`} value={bigintDraft} onChange={onNumber} {...(fieldError ? { error: fieldError } : {})} />
      ) : meta.kind === 'rial' ? (
        <MoneyInput label={`${meta.label} جدید`} value={bigintDraft} onChange={onNumber} {...(fieldError ? { error: fieldError } : {})} />
      ) : meta.kind === 'minutes' ? (
        <CountInput label={`${meta.label} جدید (دقیقه)`} value={bigintDraft} onChange={onNumber} {...(fieldError ? { error: fieldError } : {})} />
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={`setting-${setting.key}`} className="block text-sm font-medium">
            {meta.label} جدید
          </label>
          <Select id={`setting-${setting.key}`} value={draft} onChange={(event) => setDraft(event.target.value)}>
            {Object.entries(ROUNDING_POLICY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        ذخیره یک نسخه‌ی تازه از همین لحظه می‌سازد؛ فاکتورها و خریدهای گذشته با تنظیمات زمان خودشان باقی
        می‌مانند.
      </p>
      {error ? <ApiErrorNotice error={error} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => void save()} disabled={isSubmitting || unchanged || validation !== null}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          ذخیره نسخه جدید
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={isSubmitting}>
          انصراف
        </Button>
      </div>
    </div>
  );
}

function SettingCard({ setting, canEdit }: { setting: GeneralSetting; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const meta = SETTING_META[setting.key];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6" aria-label={meta.label}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">{meta.label}</h2>
            <p className="text-xs leading-5 text-muted-foreground">{meta.description}</p>
          </div>
          <div className="shrink-0 space-y-1 text-end">
            <SettingValue setting={setting} />
            <p className="text-xs text-muted-foreground tabular-nums">
              نسخه {formatCount(setting.version)} · از {formatJalaliDateTime(new Date(setting.validFrom))}
            </p>
          </div>
        </div>
        {canEdit && !editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            تغییر {meta.label}
          </Button>
        ) : null}
        {editing ? (
          <SettingEditor key={`${setting.key}:${setting.version}`} setting={setting} onDone={() => setEditing(false)} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function GeneralSettingsPage() {
  const { data, isLoading, isError, refetch } = useGeneralSettings();
  const canEdit = useHasRole(GENERAL_SETTINGS_EDIT_ROLES);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="تنظیمات عمومی" />
      <div className="flex-1 space-y-4 p-4 pb-6">
        <Link
          to="/settings"
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          بیشتر
        </Link>

        {!canEdit ? (
          <p className="text-sm text-muted-foreground" role="note">
            فقط مالک و مدیر می‌توانند این تنظیمات را تغییر دهند.
          </p>
        ) : null}

        {isLoading ? (
          <div className="space-y-3" aria-label="در حال دریافت تنظیمات">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
        ) : null}
        {isError ? <ErrorState description="دریافت تنظیمات ناموفق بود." onRetry={() => void refetch()} /> : null}
        {data ? (
          <div className="space-y-3">
            {data.settings.map((setting) => (
              <SettingCard key={setting.key} setting={setting} canEdit={canEdit} />
            ))}
          </div>
        ) : null}
      </div>
      {/* FE-084: بدون این، فیلدهای عددی صفحه نه با لمس و نه با کیبورد قابل ویرایش بودند. */}
      <NumericKeypad />
    </div>
  );
}
