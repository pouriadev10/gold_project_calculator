import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, CircleDollarSign, History, Loader2, Plus } from 'lucide-react';
import { formatCount, formatKarat, toSafeNumber } from '@gold/core-calc';
import { createCoinType, createCoinTypeVersion } from '@/api/coin-types';
import {
  createCoinTypeSchema,
  createCoinTypeVersionSchema,
  type CoinMintType,
  type CoinTypeHistory,
  type CoinTypeVersion,
  type CreateCoinTypeInput,
  type CreateCoinTypeVersionInput,
} from '@/api/contracts';
import { useCoinTypeCatalog } from '@/api/queries';
import { formatCoinWeightUg } from '@/lib/coin-type';
import { queryKeys } from '@/api/query-keys';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { KaratInput } from '@/components/keypad/KaratInput';
import { NumericField } from '@/components/keypad/NumericField';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { UnsavedChangesGuard } from '@/components/common/UnsavedChangesGuard';
import { useHasRole } from '@/hooks/useHasRole';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { formatJalaliDateTime } from '@/lib/date';
import { COIN_TYPE_EDIT_ROLES } from '@/lib/permissions';
import { toast } from '@/stores/toast-store';

/**
 * تنظیمات انواع سکه — FE-081، روی `GET /inventory/coin-types/history` و
 * `POST /inventory/coin-types[/:id/versions]`.
 *
 * - **هیچ مقدار پیش‌فرضی در UI نیست:** وزن، عیار و نوع ضرب هر نوع از API
 *   می‌آید؛ فرم نوع تازه با فیلدهای خالی شروع می‌شود و نوع ضرب را کاربر
 *   صریحاً انتخاب می‌کند.
 * - **تغییر = نسخه‌ی تازه:** نسخه‌ی جدید از «اکنون» معتبر است و نسخه‌ی قبلی
 *   در سرور با تاریخ پایان بسته می‌شود؛ سندهای گذشته به نسخه‌ی زمان خودشان
 *   اشاره دارند. تاریخچه‌ی هر نوع با بازه‌ی اعتبار هر نسخه دیده می‌شود.
 * - **حباب فقط برای `isCentralBankMinted`:** نشان «حباب‌دار» فقط روی
 *   ضرب بانک مرکزی است و سرور این پرچم را از نوع ضرب مشتق می‌کند، نه از
 *   ورودی کاربر (قاعده‌ی ۲-۳).
 *
 * ویرایش‌گرها درون‌صفحه‌اند، نه `ResponsiveDialog` (باگ شناخته‌شده‌ی آن).
 * کلید طلا/ریال ندارد: این صفحه هیچ مبلغ یا مانده‌ای نشان نمی‌دهد؛ وزن و
 * عیار مشخصات مرجع‌اند، نه عدد مالی.
 */

const MINT_LABEL: Record<CoinMintType, string> = {
  CENTRAL_BANK: 'ضرب بانک مرکزی',
  PRIVATE_MINT: 'ضرب خصوصی',
  OTHER: 'سایر',
};

const MINT_TYPES = Object.keys(MINT_LABEL) as CoinMintType[];

interface CoinTypeDraft {
  readonly code: string;
  readonly title: string;
  readonly mintType: CoinMintType | '';
  readonly grossWeightUg: bigint;
  readonly karat: bigint;
  readonly active: boolean;
}

const EMPTY_DRAFT: CoinTypeDraft = { code: '', title: '', mintType: '', grossWeightUg: 0n, karat: 0n, active: true };

function draftFromVersion(code: string, version: CoinTypeVersion): CoinTypeDraft {
  return {
    code,
    title: version.title,
    mintType: version.mintType,
    grossWeightUg: BigInt(version.grossWeightUg),
    karat: BigInt(version.karat),
    active: version.active,
  };
}

/** ورودی قرارداد از پیش‌نویس، یا `null` اگر هنوز کامل نیست. */
function specificationOf(draft: CoinTypeDraft): CreateCoinTypeVersionInput | null {
  if (draft.mintType === '' || draft.karat > 1000n) return null;
  const parsed = createCoinTypeVersionSchema.safeParse({
    title: draft.title,
    mintType: draft.mintType,
    grossWeightUg: draft.grossWeightUg.toString(),
    karat: toSafeNumber(draft.karat),
    active: draft.active,
  });
  return parsed.success ? parsed.data : null;
}

function sameSpecification(draft: CoinTypeDraft, version: CoinTypeVersion): boolean {
  return (
    draft.title.trim() === version.title &&
    draft.mintType === version.mintType &&
    draft.grossWeightUg.toString() === version.grossWeightUg &&
    draft.karat === BigInt(version.karat) &&
    draft.active === version.active
  );
}

function MintBadges({ version }: { version: Pick<CoinTypeVersion, 'mintType' | 'isCentralBankMinted' | 'active'> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline">{MINT_LABEL[version.mintType]}</Badge>
      {version.isCentralBankMinted ? <Badge variant="secondary">حباب‌دار</Badge> : null}
      {version.active ? <Badge variant="outline">فعال</Badge> : <Badge variant="destructive">غیرفعال</Badge>}
    </div>
  );
}

function validityText(version: CoinTypeVersion): string {
  const from = formatJalaliDateTime(new Date(version.validFrom));
  return version.validTo === null
    ? `از ${from} تا اکنون`
    : `از ${from} تا ${formatJalaliDateTime(new Date(version.validTo))}`;
}

/**
 * فیلدهای مشترک نوع تازه و نسخه‌ی تازه. فقط پس از دانستن مقدار اولیه mount
 * می‌شود و state را همگام از آن می‌سازد (باگ seed-race در `NumericField`).
 */
function CoinTypeFields({
  draft,
  onChange,
  withCode,
  showErrors,
  codeTaken = false,
}: {
  draft: CoinTypeDraft;
  onChange: (draft: CoinTypeDraft) => void;
  withCode: boolean;
  showErrors: boolean;
  codeTaken?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<CoinTypeDraft>) => onChange({ ...draft, ...patch });
  const codeError = codeTaken
    ? 'این کد قبلاً برای نوع سکه‌ی دیگری ثبت شده است'
    : showErrors && draft.code.trim() === ''
      ? 'کد الزامی است'
      : undefined;
  const titleError = showErrors && draft.title.trim() === '' ? 'عنوان الزامی است' : undefined;
  const mintError = showErrors && draft.mintType === '' ? 'نوع ضرب را انتخاب کنید' : undefined;
  const weightError = showErrors && draft.grossWeightUg <= 0n ? 'وزن ناخالص باید بزرگ‌تر از صفر باشد' : undefined;
  const karatError =
    showErrors && (draft.karat < 1n || draft.karat > 1000n) ? 'عیار باید بین ۱ و ۱۰۰۰ باشد' : undefined;

  return (
    <div className="space-y-3">
      {withCode ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-code`} className="text-xs font-medium text-muted-foreground">
            کد نوع (بعداً تغییر نمی‌کند)
          </label>
          <Input
            id={`${id}-code`}
            value={draft.code}
            onChange={(event) => set({ code: event.target.value })}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={Boolean(codeError)}
          />
          {codeError ? <p role="alert" className="text-xs text-destructive">{codeError}</p> : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="text-xs font-medium text-muted-foreground">
          عنوان
        </label>
        <Input
          id={`${id}-title`}
          value={draft.title}
          onChange={(event) => set({ title: event.target.value })}
          maxLength={200}
          aria-invalid={Boolean(titleError)}
        />
        {titleError ? <p role="alert" className="text-xs text-destructive">{titleError}</p> : null}
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-mint`} className="text-xs font-medium text-muted-foreground">
          نوع ضرب
        </label>
        <Select
          id={`${id}-mint`}
          value={draft.mintType}
          onChange={(event) => set({ mintType: event.target.value as CoinMintType | '' })}
          aria-invalid={Boolean(mintError)}
        >
          <option value="" disabled>
            انتخاب کنید
          </option>
          {MINT_TYPES.map((mint) => (
            <option key={mint} value={mint}>
              {MINT_LABEL[mint]}
            </option>
          ))}
        </Select>
        {mintError ? (
          <p role="alert" className="text-xs text-destructive">{mintError}</p>
        ) : draft.mintType === 'CENTRAL_BANK' ? (
          <p className="text-xs leading-5 text-muted-foreground">
            حباب‌دار: قیمت بازار این سکه جدا از ارزش ذاتی‌اش ثبت و حباب آن گزارش می‌شود.
          </p>
        ) : draft.mintType !== '' ? (
          <p className="text-xs leading-5 text-muted-foreground">
            بدون حباب: فقط سکه‌ی ضرب بانک مرکزی حباب دارد.
          </p>
        ) : null}
      </div>

      <NumericField
        kind="coinWeight"
        label="وزن ناخالص مرجع"
        value={draft.grossWeightUg}
        onChange={(grossWeightUg) => set({ grossWeightUg })}
        error={weightError}
        hint="گرم، تا شش رقم اعشار — وزن رسمی بدون گرد کردن."
      />

      <KaratInput
        label="عیار"
        value={draft.karat}
        onChange={(karat) => set({ karat })}
        {...(karatError ? { error: karatError } : {})}
      />

      <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-md px-1 text-sm">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => set({ active: event.target.checked })}
          className="size-5 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        فعال — در فروش، خرید و تسویه‌ی تازه قابل انتخاب است
      </label>
      {!draft.active ? (
        <p className="text-xs leading-5 text-muted-foreground" role="note">
          نوع غیرفعال در معامله‌ی تازه انتخاب نمی‌شود؛ سندها و مانده‌های گذشته‌اش دست نمی‌خورند.
        </p>
      ) : null}
    </div>
  );
}

function VersionEditor({ type, onDone }: { type: CoinTypeHistory; onDone: () => void }) {
  const queryClient = useQueryClient();
  const latest = type.versions[0]!;
  const [draft, setDraft] = useState(() => draftFromVersion(type.code, latest));
  const [error, setError] = useState<unknown>(null);
  const [attempted, setAttempted] = useState(false);
  const specification = specificationOf(draft);
  const unchanged = sameSpecification(draft, latest);
  const { submit, isSubmitting } = useIdempotentSubmit((key: string, input: CreateCoinTypeVersionInput) =>
    createCoinTypeVersion(type.coinTypeId, input, key),
  );

  async function save(): Promise<void> {
    setAttempted(true);
    if (specification === null || unchanged) return;
    setError(null);
    try {
      const created = await submit(specification);
      if (!created) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.coinTypes.all() });
      toast.success(`${created.title} ذخیره شد`, `نسخه ${formatCount(created.version)} از همین لحظه معتبر است.`);
      onDone();
    } catch (caught: unknown) {
      setError(caught);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <UnsavedChangesGuard when={!unchanged} submitting={isSubmitting} />
      <h3 className="text-sm font-semibold">نسخه جدید</h3>
      <CoinTypeFields draft={draft} onChange={setDraft} withCode={false} showErrors={attempted} />
      <p className="text-xs leading-5 text-muted-foreground">
        ذخیره یک نسخه‌ی تازه از همین لحظه می‌سازد و نسخه‌ی فعلی را می‌بندد؛ فاکتورها و خریدهای گذشته با
        مشخصات زمان خودشان باقی می‌مانند.
      </p>
      {error ? <ApiErrorNotice error={error} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => void save()} disabled={isSubmitting || unchanged}>
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

function NewCoinTypeForm({ existingCodes, onDone }: { existingCodes: ReadonlySet<string>; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CoinTypeDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<unknown>(null);
  const [attempted, setAttempted] = useState(false);
  const specification = specificationOf(draft);
  // پیش‌بررسی روی فهرست همین صفحه؛ سرور زیر قفل دوباره می‌سنجد و ۴۰۹ می‌دهد.
  const codeTaken = existingCodes.has(draft.code.trim());
  const { submit, isSubmitting } = useIdempotentSubmit((key: string, input: CreateCoinTypeInput) =>
    createCoinType(input, key),
  );

  async function save(): Promise<void> {
    setAttempted(true);
    const parsed = specification ? createCoinTypeSchema.safeParse({ code: draft.code, ...specification }) : null;
    if (!parsed?.success || codeTaken) return;
    setError(null);
    try {
      const created = await submit(parsed.data);
      if (!created) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.coinTypes.all() });
      toast.success(`${created.title} اضافه شد`, 'نسخه ۱ از همین لحظه معتبر است.');
      onDone();
    } catch (caught: unknown) {
      setError(caught);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <UnsavedChangesGuard
          when={(Object.keys(EMPTY_DRAFT) as (keyof CoinTypeDraft)[]).some((key) => draft[key] !== EMPTY_DRAFT[key])}
          submitting={isSubmitting}
        />
        <h2 className="text-sm font-semibold">نوع سکه‌ی تازه</h2>
        <CoinTypeFields draft={draft} onChange={setDraft} withCode showErrors={attempted} codeTaken={codeTaken} />
        {error ? <ApiErrorNotice error={error} /> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" onClick={() => void save()} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            ثبت نوع سکه
          </Button>
          <Button type="button" variant="outline" onClick={onDone} disabled={isSubmitting}>
            انصراف
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VersionHistory({ type }: { type: CoinTypeHistory }) {
  return (
    <ol className="space-y-2 border-t border-border pt-3" aria-label={`تاریخچه نسخه‌های ${type.versions[0]!.title}`}>
      {type.versions.map((version) => (
        <li key={version.id} className="space-y-1.5 rounded-md bg-muted/50 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              نسخه {formatCount(version.version)} · {version.title}
            </span>
            <MintBadges version={version} />
          </div>
          <p className="tabular-nums text-muted-foreground">{validityText(version)}</p>
          <p className="tabular-nums">
            وزن {formatCoinWeightUg(BigInt(version.grossWeightUg))} گرم · عیار {formatKarat(version.karat)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function CoinTypeCard({ type, canEdit }: { type: CoinTypeHistory; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const historyId = useId();
  const current = type.versions[0]!;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6" aria-label={current.title}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">{current.title}</h2>
            <p className="text-xs text-muted-foreground">
              کد <bdi className="font-mono">{type.code}</bdi>
            </p>
          </div>
          <MintBadges version={current} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">وزن ناخالص</dt>
            <dd className="font-semibold tabular-nums">{formatCoinWeightUg(BigInt(current.grossWeightUg))} گرم</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">عیار</dt>
            <dd className="font-semibold tabular-nums">{formatKarat(current.karat)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">اعتبار نسخه {formatCount(current.version)}</dt>
            <dd className="tabular-nums">{validityText(current)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={showHistory}
            aria-controls={historyId}
            onClick={() => setShowHistory((open) => !open)}
          >
            <History className="size-4" aria-hidden="true" />
            تاریخچه نسخه‌ها ({formatCount(type.versions.length)})
            <ChevronDown
              className={showHistory ? 'size-4 rotate-180 transition-transform motion-reduce:transition-none' : 'size-4'}
              aria-hidden="true"
            />
          </Button>
          {canEdit && !editing ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Plus className="size-4" aria-hidden="true" />
              نسخه جدید
            </Button>
          ) : null}
        </div>

        <div id={historyId}>{showHistory ? <VersionHistory type={type} /> : null}</div>
        {editing ? (
          <VersionEditor key={`${type.coinTypeId}:${current.version}`} type={type} onDone={() => setEditing(false)} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function CoinTypeSettingsPage() {
  const { data, isLoading, isError, refetch } = useCoinTypeCatalog();
  const canEdit = useHasRole(COIN_TYPE_EDIT_ROLES);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="انواع سکه" />
      <div className="flex-1 space-y-4 p-4 pb-6">
        <Link
          to="/settings"
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          بیشتر
        </Link>

        <p className="text-sm leading-6 text-muted-foreground">
          هر نوع سکه بُعد شمارشی جداگانه‌ای در دفتر کل است. وزن و عیار اینجا فقط مشخصات مرجع برای ارزش ذاتی و
          حباب‌اند؛ مانده‌ها همیشه تعداد سکه می‌مانند.
        </p>

        {!canEdit ? (
          <p className="text-sm text-muted-foreground" role="note">
            فقط مالک و مدیر می‌توانند نوع یا نسخه‌ی تازه بسازند.
          </p>
        ) : null}

        {isLoading ? (
          <div className="space-y-3" aria-label="در حال دریافت انواع سکه">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
        ) : null}
        {isError ? <ErrorState description="دریافت انواع سکه ناموفق بود." onRetry={() => void refetch()} /> : null}
        {data && data.types.length === 0 ? (
          <EmptyState
            icon={CircleDollarSign}
            title="هنوز نوع سکه‌ای تعریف نشده"
            description={canEdit ? 'با «افزودن نوع سکه» اولین نوع را بسازید.' : 'مالک یا مدیر باید انواع سکه را تعریف کند.'}
          />
        ) : null}
        {data ? (
          <div className="space-y-3">
            {data.types.map((type) => (
              <CoinTypeCard key={type.coinTypeId} type={type} canEdit={canEdit} />
            ))}
          </div>
        ) : null}

        {canEdit && data ? (
          adding ? (
            <NewCoinTypeForm
              existingCodes={new Set(data.types.map((type) => type.code))}
              onDone={() => setAdding(false)}
            />
          ) : (
            <Button type="button" className="w-full" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن نوع سکه
            </Button>
          )
        ) : null}
      </div>
      {/* FE-084: بدون این، فیلدهای عددی صفحه نه با لمس و نه با کیبورد قابل ویرایش بودند. */}
      <NumericKeypad />
    </div>
  );
}
