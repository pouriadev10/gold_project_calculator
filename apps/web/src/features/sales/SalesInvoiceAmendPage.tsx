import { useCallback, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, FilePenLine } from 'lucide-react';
import {
  amendSalesInvoiceSchema,
  type AmendSalesInvoiceInput,
  type AmendedSalesInvoice,
} from '@gold/contracts';
import {
  dualFromRial,
  formatCount,
  formatGram,
  formatKarat,
  formatScaled,
  toSafeNumber,
} from '@gold/core-calc';
import type { SalesInvoiceDetail } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import {
  useCoinTypes,
  useInvoiceAmendmentPolicy,
  useInvoiceVersions,
  useJewelryItemAt,
  useJewelryItems,
  useSalesInvoiceDetail,
} from '@/api/queries';
import { amendSalesInvoice } from '@/api/sales';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PartySelector } from '@/components/common/PartySelector';
import { UnitToggle } from '@/components/common/UnitToggle';
import { CountInput } from '@/components/keypad/CountInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import type { PartySelection } from '@/stores/recent-parties-store';

const REASONS: readonly { value: InvoiceAmendmentReason; label: string }[] = [
  { value: 'WEIGHT_ERROR', label: 'اشتباه وزن' },
  { value: 'KARAT_ERROR', label: 'اشتباه عیار' },
  { value: 'WAGE_ERROR', label: 'اشتباه اجرت' },
  { value: 'PARTY_ERROR', label: 'اشتباه مشتری' },
  { value: 'PAYMENT_ERROR', label: 'اشتباه پرداخت' },
  { value: 'OTHER', label: 'سایر' },
];

type Version = SalesInvoiceDetail['versions'][number];
type InvoiceAmendmentReason = AmendSalesInvoiceInput['reason'];

function FinancialRow({
  label,
  rial,
  rate,
  signed = false,
}: {
  label: string;
  rial: bigint;
  rate: bigint;
  signed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <AmountDisplay amount={dualFromRial(rial, rate)} signed={signed} size="sm" />
    </div>
  );
}

function AmendmentResult({
  detail,
  before,
  result,
}: {
  detail: SalesInvoiceDetail;
  before: Version;
  result: AmendedSalesInvoice;
}) {
  const history = useInvoiceVersions(detail.id);
  const after = history.data?.versions.find((version) => version.version === result.version);
  const rate = BigInt(detail.quoteSnapshot!.goldRatePerGramRial);
  const payableDifference = BigInt(result.payableRial) - BigInt(before.payableRial);
  const balanceDifference = BigInt(result.receivableRial) - BigInt(before.receivableRial);
  const isCoin = before.items[0]?.itemType === 'COIN';
  const beforeCoinCount = isCoin ? BigInt(before.items[0]!.quantity) : null;
  const afterCoinCount = after?.items.find((item) => item.itemType === 'COIN')?.quantity;
  const weightDifference =
    after?.pureWeightMg !== null &&
    after?.pureWeightMg !== undefined &&
    before.pureWeightMg !== null
      ? BigInt(after.pureWeightMg) - BigInt(before.pureWeightMg)
      : null;

  return (
    <div className="space-y-4">
      <Card aria-label="نتیجه اصلاح فاکتور">
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <CheckCircle2 className="size-5 text-credit" aria-hidden="true" />
          <CardTitle className="text-base">نسخهٔ جدید ثبت شد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="tabular-nums">
            فاکتور {formatCount(result.invoiceNumber)} · نسخهٔ {formatCount(result.version)}
          </p>
          <p className="leading-6 text-muted-foreground">
            شمارهٔ فاکتور ثابت ماند. نسخهٔ قبلی و سندهای آن تغییر نکرده‌اند؛ فقط نسخهٔ جدید و اثر
            تفاضلی آن ثبت شده‌اند.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">قبل · نسخهٔ {formatCount(before.version)}</CardTitle>
          </CardHeader>
          <CardContent>
            <FinancialRow label="مبلغ" rial={BigInt(before.payableRial)} rate={rate} />
            <FinancialRow label="مانده" rial={BigInt(before.receivableRial)} rate={rate} />
            {before.pureWeightMg !== null ? (
              <p className="py-2 text-sm tabular-nums">
                وزن خالص: {formatGram(BigInt(before.pureWeightMg))} گرم
              </p>
            ) : null}
            {beforeCoinCount !== null ? (
              <p className="py-2 text-sm tabular-nums">
                تعداد سکه: {formatCount(toSafeNumber(beforeCoinCount))}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">بعد · نسخهٔ {formatCount(result.version)}</CardTitle>
          </CardHeader>
          <CardContent>
            <FinancialRow label="مبلغ" rial={BigInt(result.payableRial)} rate={rate} />
            <FinancialRow label="مانده" rial={BigInt(result.receivableRial)} rate={rate} />
            {isCoin && afterCoinCount !== undefined ? (
              <p className="py-2 text-sm tabular-nums">
                تعداد سکه: {formatCount(toSafeNumber(BigInt(afterCoinCount)))}
              </p>
            ) : isCoin && history.isError ? (
              <p className="text-xs text-warning">
                تعداد نسخهٔ جدید دریافت نشد. برای مشاهده دوباره تلاش کنید.
              </p>
            ) : isCoin ? (
              <p className="text-xs text-muted-foreground">در حال دریافت تعداد ثبت‌شدهٔ سکه…</p>
            ) : after?.pureWeightMg !== null && after?.pureWeightMg !== undefined ? (
              <p className="py-2 text-sm tabular-nums">
                وزن خالص: {formatGram(BigInt(after.pureWeightMg))} گرم
              </p>
            ) : history.isError ? (
              <p className="text-xs text-warning">
                وزن نسخهٔ جدید دریافت نشد. برای مشاهده دوباره تلاش کنید.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                در حال دریافت وزن ثبت‌شدهٔ نسخهٔ جدید…
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">اثر اصلاح</CardTitle>
        </CardHeader>
        <CardContent>
          <FinancialRow label="اختلاف مبلغ" rial={payableDifference} rate={rate} signed />
          <FinancialRow label="تغییر ماندهٔ مشتری" rial={balanceDifference} rate={rate} signed />
          {weightDifference !== null ? (
            <p className="py-2 text-sm tabular-nums">
              اختلاف وزن خالص: {formatGram(weightDifference)} گرم
            </p>
          ) : null}
          {beforeCoinCount !== null && afterCoinCount !== undefined ? (
            <p className="py-2 text-sm tabular-nums">
              اختلاف تعداد سکه:{' '}
              {formatCount(toSafeNumber(BigInt(afterCoinCount) - beforeCoinCount))}
            </p>
          ) : null}
          {history.isError ? (
            <Button type="button" variant="outline" onClick={() => void history.refetch()}>
              تلاش دوباره برای وزن
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <Button asChild size="action" className="w-full">
        <Link to="/sales/invoices/$invoiceId" params={{ invoiceId: detail.id }}>
          دیدن فاکتور
        </Link>
      </Button>
    </div>
  );
}

function AmendmentForm({
  detail,
  before,
  onCompleted,
  submitAllowed,
  checkingPolicy,
}: {
  detail: SalesInvoiceDetail;
  before: Version;
  onCompleted: (result: AmendedSalesInvoice) => void;
  submitAllowed: boolean;
  checkingPolicy: boolean;
}) {
  const queryClient = useQueryClient();
  const item = before.items.length === 1 ? before.items[0] : undefined;
  const [party, setParty] = useState<PartySelection | null>({
    ...detail.party,
    mobile: null,
    nationalIdMasked: null,
  });
  const [itemId, setItemId] = useState(item?.itemId ?? '');
  const [search, setSearch] = useState('');
  const [count, setCount] = useState(item?.itemType === 'COIN' ? BigInt(item.quantity) : 1n);
  const [marketUnitPriceRial, setMarketUnitPriceRial] = useState(0n);
  const [paidRial, setPaidRial] = useState(BigInt(before.paidRial));
  const [reason, setReason] = useState<InvoiceAmendmentReason>('OTHER');
  const [reasonDetail, setReasonDetail] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const effectiveAt =
    detail.versions.find((version) => version.version === 1)?.createdAt ?? detail.occurredAt;
  const debouncedSearch = useDebouncedValue(search, 300).trim();
  const jewelry = useJewelryItems(
    {
      active: true,
      limit: 200,
      offset: 0,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    },
    item?.itemType === 'JEWELRY',
  );
  const jewelryAt = useJewelryItemAt(
    item?.itemType === 'JEWELRY' && itemId ? itemId : null,
    item?.itemType === 'JEWELRY' ? effectiveAt : null,
  );
  const coinTypes = useCoinTypes(item?.itemType === 'COIN');

  const action = useCallback(
    (key: string, payload: AmendSalesInvoiceInput) => amendSalesInvoice(detail.id, payload, key),
    [detail.id],
  );
  const submission = useIdempotentSubmit(action);

  async function submit(): Promise<void> {
    if (!submitAllowed) return;
    setError(null);
    setValidationError(null);
    if (!party || !item || !itemId || party.status !== 'ACTIVE') {
      setValidationError('مشتری و قلم معتبر را انتخاب کنید.');
      return;
    }
    if (
      item.itemType === 'JEWELRY' &&
      (!jewelryAt.data || jewelryAt.data.jewelryItemId !== itemId)
    ) {
      setValidationError('مشخصات تاریخی قلم انتخاب‌شده هنوز تأیید نشده است.');
      return;
    }
    if (item.itemType === 'COIN' && (count < 1n || count > BigInt(Number.MAX_SAFE_INTEGER))) {
      setValidationError('تعداد سکه نامعتبر است.');
      return;
    }
    if (reason === 'OTHER' && !reasonDetail.trim()) {
      setValidationError('برای دلیل «سایر» توضیح را وارد کنید.');
      return;
    }
    const candidate = {
      reason,
      ...(reason === 'OTHER' ? { reasonDetail: reasonDetail.trim() } : {}),
      partyId: party.id,
      item:
        item.itemType === 'JEWELRY'
          ? { itemType: 'JEWELRY' as const, jewelryItemId: itemId, paidRial: paidRial.toString() }
          : {
              itemType: 'COIN' as const,
              coinTypeId: itemId,
              count: toSafeNumber(count),
              marketUnitPriceRial: marketUnitPriceRial.toString(),
              paidRial: paidRial.toString(),
            },
    };
    const parsed = amendSalesInvoiceSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'اطلاعات فرم معتبر نیست.');
      return;
    }
    try {
      const next = await submission.submit(parsed.data);
      if (!next) return;
      onCompleted(next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.salesInvoices.versions(detail.id) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.salesInvoices.detail(detail.id),
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.salesInvoices.amendmentPolicy(detail.id),
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.salesInvoices.lists() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
      ]);
    } catch (caught: unknown) {
      setError(caught);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <FilePenLine className="size-5 text-primary" aria-hidden="true" />
          <CardTitle className="text-base">
            اصلاح فاکتور {formatCount(detail.invoiceNumber!)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-6">
          <p>نسخهٔ جاری: {formatCount(before.version)}. شمارهٔ فاکتور تغییر نمی‌کند.</p>
          <p className="text-muted-foreground">
            نسخهٔ قبلی و ثبت‌های دفترکل آن تغییرناپذیرند؛ اصلاح یک نسخه و سند تفاضلی تازه می‌سازد.
          </p>
          <p className="text-muted-foreground">
            مبلغ جدید قبل از ثبت تخمین زده نمی‌شود؛ سرور با مظنه و تنظیمات قفل‌شدهٔ همان فاکتور
            محاسبه می‌کند.
          </p>
        </CardContent>
      </Card>

      <PartySelector label="مشتری اصلاح‌شده" value={party} onChange={setParty} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">قلم قابل اصلاح</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {item?.itemType === 'JEWELRY' ? (
            <>
              <Input
                aria-label="جست‌وجوی قلم جایگزین"
                placeholder="نام یا کد کالا"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {jewelry.isError ? (
                <ErrorState
                  description="فهرست کالا دریافت نشد."
                  onRetry={() => void jewelry.refetch()}
                />
              ) : null}
              <Select
                aria-label="قلم زیورآلات"
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="">انتخاب قلم</option>
                {itemId && !jewelry.data?.items.some((row) => row.jewelryItemId === itemId) ? (
                  <option value={itemId}>{item.title} · قلم فعلی</option>
                ) : null}
                {jewelry.data?.items.map((row) => (
                  <option key={row.jewelryItemId} value={row.jewelryItemId}>
                    {row.title} · {row.code}
                  </option>
                ))}
              </Select>
              {jewelryAt.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  در حال دریافت مشخصات مؤثر در تاریخ فاکتور…
                </p>
              ) : null}
              {jewelryAt.isError ? (
                <ErrorState
                  description="این قلم در تاریخ فاکتور نسخهٔ معتبر ندارد."
                  onRetry={() => void jewelryAt.refetch()}
                />
              ) : null}
              {jewelryAt.data && jewelryAt.data.jewelryItemId === itemId ? (
                <dl className="grid gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">وزن ناخالص</dt>
                    <dd className="mt-1 tabular-nums">
                      {formatGram(BigInt(jewelryAt.data.grossWeightMg))} گرم
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">عیار</dt>
                    <dd className="mt-1 tabular-nums">{formatKarat(jewelryAt.data.karat)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">اجرت</dt>
                    <dd className="mt-1 tabular-nums">
                      {jewelryAt.data.wageType === 'PERCENT_X100' ? (
                        `${formatScaled(BigInt(jewelryAt.data.wageValue), 2)}٪`
                      ) : (
                        <>
                          <RateDisplay value={BigInt(jewelryAt.data.wageValue)} size="sm" />
                          {jewelryAt.data.wageType === 'PER_GRAM' ? ' / گرم' : ''}
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : null}
              <p className="text-xs leading-5 text-muted-foreground">
                وزن، عیار و اجرت از نسخهٔ تاریخی قلم انتخاب‌شده خوانده می‌شوند. اصلاح مستقیم این
                اعداد در قرارداد فعلی مجاز نیست؛ برای تغییرشان قلمِ دارای مشخصات درست را انتخاب
                کنید.
              </p>
            </>
          ) : item?.itemType === 'COIN' ? (
            <>
              {coinTypes.isError ? (
                <ErrorState
                  description="انواع سکه دریافت نشد."
                  onRetry={() => void coinTypes.refetch()}
                />
              ) : null}
              <Select
                aria-label="نوع سکه"
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="">انتخاب نوع سکه</option>
                {itemId &&
                !coinTypes.data?.some((row) => row.coinTypeId === itemId && row.active) ? (
                  <option value={itemId}>{item.title} · نوع فعلی</option>
                ) : null}
                {coinTypes.data
                  ?.filter((row) => row.active)
                  .map((row) => (
                    <option key={row.coinTypeId} value={row.coinTypeId}>
                      {row.title}
                    </option>
                  ))}
              </Select>
              <CountInput
                label="تعداد سکه"
                value={count}
                onChange={setCount}
                disabled={submission.isSubmitting}
              />
              <MoneyInput
                label="قیمت واحد بازار"
                value={marketUnitPriceRial}
                onChange={setMarketUnitPriceRial}
                disabled={submission.isSubmitting}
              />
            </>
          ) : (
            <p className="text-sm text-warning">
              این فاکتور فقط با یک قلم زیورآلات یا سکه قابل اصلاح است.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">پرداخت و دلیل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MoneyInput
            label="مبلغ پرداختی اصلاح‌شده"
            value={paidRial}
            onChange={setPaidRial}
            disabled={submission.isSubmitting}
          />
          <div className="space-y-1.5">
            <label htmlFor="amend-reason" className="text-sm font-medium">
              دلیل اصلاح
            </label>
            <Select
              id="amend-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as InvoiceAmendmentReason)}
              disabled={submission.isSubmitting}
            >
              {REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          {reason === 'OTHER' ? (
            <div className="space-y-1.5">
              <label htmlFor="amend-reason-detail" className="text-sm font-medium">
                توضیح دلیل
              </label>
              <Textarea
                id="amend-reason-detail"
                value={reasonDetail}
                onChange={(event) => setReasonDetail(event.target.value)}
                disabled={submission.isSubmitting}
                required
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {validationError ? (
        <p role="alert" className="text-sm text-destructive">
          {validationError}
        </p>
      ) : null}
      {error ? <ApiErrorNotice error={error} /> : null}
      {checkingPolicy ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          در حال بررسی دوبارهٔ مجوز اصلاح…
        </p>
      ) : null}
      <Button
        type="button"
        size="action"
        className="w-full"
        disabled={!submitAllowed || submission.isSubmitting || !item}
        onClick={() => void submit()}
      >
        {submission.isSubmitting ? 'در حال ثبت نسخهٔ جدید…' : 'ثبت اصلاح فاکتور'}
      </Button>
      <NumericKeypad />
    </div>
  );
}

export default function SalesInvoiceAmendPage() {
  const { invoiceId } = useParams({ from: '/app-shell/sales/invoices/$invoiceId/amend' });
  const detail = useSalesInvoiceDetail(invoiceId);
  const policy = useInvoiceAmendmentPolicy(invoiceId);
  const [completed, setCompleted] = useState<{
    detail: SalesInvoiceDetail;
    before: Version;
    result: AmendedSalesInvoice;
  } | null>(null);
  const before = detail.data?.versions.find(
    (version) => version.version === detail.data.currentVersion,
  );
  const canDisplayForm =
    detail.data?.status === 'FINALIZED' &&
    policy.data?.invoiceId === invoiceId &&
    policy.data.invoiceVersion === detail.data.currentVersion &&
    policy.data.allowed;
  const submitAllowed =
    canDisplayForm &&
    !policy.isFetching &&
    !policy.isError &&
    !detail.isFetching &&
    !detail.isError;

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="اصلاح فاکتور">
        <UnitToggle />
      </PageHeader>
      <main className="flex-1 space-y-4 p-4 pb-action">
        <Link
          to="/sales/invoices/$invoiceId"
          params={{ invoiceId }}
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          بازگشت به فاکتور
        </Link>
        {detail.isLoading || policy.isLoading ? <CardSkeleton lines={5} /> : null}
        {detail.isError || policy.isError ? (
          <ErrorState
            description="اطلاعات یا مجوز اصلاح دریافت نشد."
            onRetry={() => {
              void detail.refetch();
              void policy.refetch();
            }}
          />
        ) : null}
        {completed ? <AmendmentResult {...completed} /> : null}
        {!completed &&
        detail.data &&
        before &&
        policy.data &&
        !canDisplayForm &&
        !policy.isFetching ? (
          <Card>
            <CardContent className="flex items-start gap-2 py-5 text-sm text-warning">
              <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
              اصلاح این نسخه مجاز نیست یا مجوز با نسخهٔ جاری فاکتور سازگار نیست. برای بررسی دلیل به
              صفحهٔ فاکتور برگردید.
            </CardContent>
          </Card>
        ) : null}
        {!completed && detail.data && before && canDisplayForm ? (
          <AmendmentForm
            key={`${detail.data.id}:${detail.data.currentVersion}`}
            detail={detail.data}
            before={before}
            submitAllowed={submitAllowed}
            checkingPolicy={policy.isFetching}
            onCompleted={(result) => setCompleted({ detail: detail.data!, before, result })}
          />
        ) : null}
      </main>
    </div>
  );
}
