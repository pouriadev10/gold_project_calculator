import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { bullionPrice, coinPositionValue, formatCount, formatRial, grossMg, karat as toKarat, rial, toSafeNumber } from '@gold/core-calc';
import { createMixedSettlementSchema, type CreateMixedSettlementInput, type MixedSettlement } from '@/api/contracts';
import { createMixedSettlement } from '@/api/settlements';
import { useCoinTypes, usePartyBalances } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { RialAmount } from '@/components/common/RialAmount';
import { OFFLINE_SUBMIT_MESSAGE } from '@/components/common/OfflineSubmitHint';
import { PENDING_SUBMIT_ACTION, PendingSubmitNotice } from '@/components/common/PendingSubmitNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { CountInput } from '@/components/keypad/CountInput';
import { KaratInput } from '@/components/keypad/KaratInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { WeightInput } from '@/components/keypad/WeightInput';
import { UnsavedChangesGuard } from '@/components/common/UnsavedChangesGuard';
import { useMazneh, type MaznehSnapshot } from '@/features/home/useMazneh';
import { useFinancialSubmit } from '@/hooks/useFinancialSubmit';
import { documentQuoteRate } from '@/lib/document-rate';
import { toast } from '@/stores/toast-store';

/**
 * تسویه‌ی ترکیبی — FE-054، «هر روش component مستقل داشته باشد» (FE-050).
 * برخلاف FE-051..053 که هر کدام دقیقاً یک ردیف می‌سازند، این یکی سبد
 * چندردیفی `POST /parties/:partyId/settlements/mixed` (BE-048) است: یک
 * درخواست، یک `Idempotency-Key`، یک تراکنش اتمیک سرور برای کل آرایه‌ی
 * `lines` — دقیقاً همان قاعده‌ی «submit اتمیک تلقی شود».
 *
 * **چهارمین نوع ردیف («مانده اعتباری») همان `CREDIT` واقعی است** —
 * `createMixedSettlementSchema` یک ردیف `CREDIT` دارد که «اعتبار ریالی
 * موجود شخص» را روی طلبش اعمال می‌کند. سقف واقعی‌اش (`availableCreditRial`
 * در `MixedSettlementsService`) از حساب پرداختنی شخص می‌آید که هیچ GET
 * جداگانه‌ای ندارد؛ اینجا از `rawBalances.rial` منفی (`GET
 * /parties/:id/balances`، که خودش receivable و payable را ترکیب‌شده
 * برمی‌گرداند) به‌عنوان تقریب معتبر استفاده شده — پیش‌نمایش کلاینت است،
 * سرور مرجع نهایی می‌ماند.
 *
 * **یک مظنه‌ی قفل‌شده برای کل فرم**، نه هر ردیف جدا — این یک معامله‌ی
 * واحد در یک لحظه است (همان استدلال «submit اتمیک»)؛ فقط وقتی حداقل یک
 * ردیف طلا/سکه وجود دارد لازم می‌شود. «نرخ هر ردیف جدا نمایش داده شود»
 * با این برآورده می‌شود که هر ردیف طلا/سکه پیش‌نمایش و نرخ خودش را زیر
 * فیلدهایش نشان می‌دهد، نه اینکه نرخ فقط یک‌جا در پایین فرم پنهان بماند.
 *
 * **خطای هر ردیف کنار همان ردیف** — فقط برای اعتبارسنجی کلاینتی (فیلد
 * خالی، سقف اعتبار). خطای سرور (مثل رد کل تسویه) سرویس‌های واقعی
 * (`MixedSettlementInsufficientCreditError` و مشابه) هیچ اندیس ردیفی
 * برنمی‌گردانند — پس آن خطا سراسری نمایش داده می‌شود (`ApiErrorNotice`)،
 * نه به یک ردیف خاص چسبانده می‌شود.
 */

type MixedLine =
  | { readonly id: string; readonly type: 'RIAL'; readonly amountRial: bigint }
  | { readonly id: string; readonly type: 'GOLD'; readonly grossWeightMg: bigint; readonly karat: bigint }
  | {
      readonly id: string;
      readonly type: 'COIN';
      readonly coinTypeId: string | null;
      readonly count: bigint;
      readonly marketUnitPriceRial: bigint;
    }
  | { readonly id: string; readonly type: 'CREDIT'; readonly amountRial: bigint };

const LINE_LABEL: Record<MixedLine['type'], string> = {
  RIAL: 'ریال',
  GOLD: 'طلا',
  COIN: 'سکه',
  CREDIT: 'مانده اعتباری',
};

/** پیش‌نمایش ریالی یک ردیف، یا `undefined` اگر هنوز ناقص/نامعتبر است. */
function previewOf(line: MixedLine, rate1000: bigint | undefined): bigint | undefined {
  switch (line.type) {
    case 'RIAL':
    case 'CREDIT':
      return line.amountRial > 0n ? line.amountRial : undefined;
    case 'GOLD': {
      if (line.grossWeightMg <= 0n || line.karat < 1n || line.karat > 1000n || rate1000 === undefined) {
        return undefined;
      }
      return bullionPrice(grossMg(line.grossWeightMg), toKarat(toSafeNumber(line.karat)), rial(rate1000));
    }
    case 'COIN': {
      if (line.coinTypeId === null || line.count <= 0n || line.marketUnitPriceRial <= 0n) return undefined;
      return coinPositionValue(toSafeNumber(line.count), rial(line.marketUnitPriceRial));
    }
  }
}

/** پیام خطای همان ردیف، یا `null` اگر معتبر است. */
function lineError(line: MixedLine, availableCreditRial: bigint): string | null {
  switch (line.type) {
    case 'RIAL':
      return line.amountRial > 0n ? null : 'مبلغ باید بزرگ‌تر از صفر باشد.';
    case 'CREDIT':
      if (line.amountRial <= 0n) return 'مبلغ باید بزرگ‌تر از صفر باشد.';
      if (line.amountRial > availableCreditRial) return 'بیشتر از مانده‌ی اعتباری موجود شخص است.';
      return null;
    case 'GOLD':
      if (line.grossWeightMg <= 0n) return 'وزن باید بزرگ‌تر از صفر باشد.';
      if (line.karat < 1n || line.karat > 1000n) return 'عیار باید بین ۱ و ۱۰۰۰ باشد.';
      return null;
    case 'COIN':
      if (line.coinTypeId === null) return 'نوع سکه انتخاب نشده است.';
      if (line.count <= 0n) return 'تعداد باید بزرگ‌تر از صفر باشد.';
      if (line.marketUnitPriceRial <= 0n) return 'نرخ بازار باید بزرگ‌تر از صفر باشد.';
      return null;
  }
}

function toRequestLine(line: MixedLine, quoteId: string | null): CreateMixedSettlementInput['lines'][number] | null {
  switch (line.type) {
    case 'RIAL':
      return { type: 'RIAL', amountRial: line.amountRial.toString() };
    case 'CREDIT':
      return { type: 'CREDIT', amountRial: line.amountRial.toString() };
    case 'GOLD':
      if (quoteId === null) return null;
      return {
        type: 'GOLD',
        grossWeightMg: line.grossWeightMg.toString(),
        karat: toSafeNumber(line.karat),
        quoteId,
      };
    case 'COIN':
      if (quoteId === null || line.coinTypeId === null) return null;
      return {
        type: 'COIN',
        coinTypeId: line.coinTypeId,
        count: toSafeNumber(line.count),
        marketUnitPriceRial: line.marketUnitPriceRial.toString(),
        quoteId,
      };
  }
}

export interface MixedSettlementFormProps {
  readonly partyId: string;
  readonly onSuccess?: (settlement: MixedSettlement) => void;
}

export function MixedSettlementForm({ partyId, onSuccess }: MixedSettlementFormProps) {
  const coinTypesQuery = useCoinTypes();
  const balancesQuery = usePartyBalances(partyId, {});
  const mazneh = useMazneh();
  const queryClient = useQueryClient();
  const nextId = useRef(0);

  const [lines, setLines] = useState<readonly MixedLine[]>([]);
  const [lockedQuote, setLockedQuote] = useState<MaznehSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<MixedSettlement | null>(null);
  /**
   * FE-104: نرخ همان سند، در لحظه‌ی ثبت گرفته می‌شود — مظنه‌ی قفل‌شده‌ی ردیف‌های طلا/سکه. سبد فقط
   * ریالی/اعتباری نرخ ندارد و نتیجه‌اش فقط ریال خام است؛ مظنه‌ی جاری هرگز به رسید راه ندارد.
   */
  const [resultRate1000, setResultRate1000] = useState<bigint | null>(null);

  const needsQuote = lines.some((line) => line.type === 'GOLD' || line.type === 'COIN');
  useEffect(() => {
    if (needsQuote && lockedQuote === null && mazneh.data) setLockedQuote(mazneh.data);
  }, [needsQuote, mazneh.data, lockedQuote]);

  /*
   * لحظه‌ی تسویه هم‌عمر کلید Idempotency است (FE-096). سرور hash ِ بدنه را کنار کلید نگه می‌دارد؛
   * FE-100 کل بدنه (ردیف‌ها، quoteId، effectiveAt) را با کلید سنجاق می‌کند: پس از خطای نامطمئن
   * ردیف‌ها قفل می‌مانند و «بررسی نتیجه» همان درخواست را تکرار می‌کند — نه ردیف‌های ویرایش‌شده.
   */
  const {
    submit: runSubmit,
    isSubmitting,
    locked,
    uncertain,
    pending,
    reset: resetKey,
    offline,
  } = useFinancialSubmit(
    (key: string, input: CreateMixedSettlementInput) => createMixedSettlement(partyId, input, key),
    { persist: { scope: `settlement:mixed:${partyId}`, schema: createMixedSettlementSchema } },
  );

  const activeCoinTypes = (coinTypesQuery.data ?? []).filter((c) => c.active);
  const rate1000 = lockedQuote?.gram1000;
  /*
   * نرخ «نمایش» جدا از نرخ «محاسبه» است: پیش‌نمایش طلا/سکه فقط با مظنه‌ی قفل‌شده ساخته می‌شود،
   * ولی تبدیل یک مبلغ ریالی به چهره‌ی طلایی برای کلید واحد همان کاری است که فرم تسویه‌ی ریالی با
   * مظنه‌ی جاری می‌کند. وقتی ردیف طلا/سکه هست، مظنه قفل است و هر دو یکی‌اند.
   */
  const displayRate1000 = rate1000 ?? mazneh.data?.gram1000;
  const receivableRial = balancesQuery.data ? BigInt(balancesQuery.data.rawBalances.rial) : undefined;
  const debtRial = receivableRial !== undefined && receivableRial > 0n ? receivableRial : 0n;
  const availableCreditRial = receivableRial !== undefined && receivableRial < 0n ? -receivableRial : 0n;

  const previews = lines.map((line) => previewOf(line, rate1000));
  const totalCoverage = previews.reduce((sum: bigint | undefined, p) => (sum === undefined || p === undefined ? undefined : sum + p), 0n);
  const remainingRial = totalCoverage !== undefined ? debtRial - totalCoverage : undefined;

  const errors = lines.map((line) => lineError(line, availableCreditRial));
  const hasQuoteGap = needsQuote && lockedQuote === null;
  const reason: string | null = offline
    ? OFFLINE_SUBMIT_MESSAGE
    : locked
      ? null // تلاش سنجاق‌شده فقط تکرار می‌شود؛ ردیف‌های فرم دیگر مبنا نیستند
      : lines.length === 0
      ? 'حداقل یک ردیف اضافه کنید.'
      : errors.some((e) => e !== null)
        ? 'یک یا چند ردیف ناقص یا نامعتبر است.'
        : hasQuoteGap
          ? 'مظنه هنوز دریافت نشده — چند لحظه صبر کنید.'
          : null;

  function addLine(type: MixedLine['type']) {
    const id = `line-${nextId.current++}`;
    const line: MixedLine =
      type === 'RIAL'
        ? { id, type: 'RIAL', amountRial: 0n }
        : type === 'CREDIT'
          ? { id, type: 'CREDIT', amountRial: 0n }
          : type === 'GOLD'
            ? { id, type: 'GOLD', grossWeightMg: 0n, karat: 0n }
            : { id, type: 'COIN', coinTypeId: null, count: 0n, marketUnitPriceRial: 0n };
    setLines((prev) => [...prev, line]);
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function updateLine(id: string, patch: Partial<MixedLine>) {
    setLines((prev) => prev.map((line) => (line.id === id ? ({ ...line, ...patch } as MixedLine) : line)));
  }

  function resetForm() {
    setLines([]);
    setLockedQuote(null);
    setError(null);
    setResult(null);
    setResultRate1000(null);
    resetKey();
  }

  async function handleSubmit() {
    if (reason !== null) return;

    const quoteId = lockedQuote?.quoteId ?? null;
    const requestLines = lines
      .map((line) => toRequestLine(line, quoteId))
      .filter((line): line is CreateMixedSettlementInput['lines'][number] => line !== null);
    // یعنی مظنه یا نوع سکه هنوز ناقص است؛ reason باید همین را قبلاً گرفته باشد (تلاش سنجاق‌شده مستثناست)
    if (!locked && requestLines.length !== lines.length) return;

    setError(null);
    // اگر تلاشی سنجاق شده باشد، هوک همان را می‌فرستد و این بدنه‌ی تازه نادیده گرفته می‌شود
    const input: CreateMixedSettlementInput = { lines: requestLines, effectiveAt: new Date().toISOString() };
    // بدنه‌ای که واقعاً می‌رود: تلاش سنجاق‌شده، وگرنه همین بدنه — نرخ سند از مظنه‌ی ردیف‌های خودش
    const sentLines = (pending?.payload ?? input).lines;
    const sentQuoteId = sentLines.flatMap((line) => (line.type === 'GOLD' || line.type === 'COIN' ? [line.quoteId] : []))[0];
    const documentRate = documentQuoteRate(sentQuoteId, lockedQuote);

    try {
      const settlement = await runSubmit(input);
      if (!settlement) return;

      setResultRate1000(documentRate);
      setResult(settlement);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryBalances.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryMovements.all() }),
      ]);

      toast.success('تسویه‌ی ترکیبی ثبت شد', `${formatRial(settlement.totalSettledRial)} ریال`);
      onSuccess?.(settlement);
    } catch (caught) {
      setError(caught);
    }
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">تسویه‌ی ترکیبی ثبت شد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">مجموع تسویه‌شده</span>
            <RialAmount value={result.totalSettledRial} rate1000={resultRate1000} />
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {result.lines.map((line, index) => (
              <li key={`${line.type}-${index}`} className="flex items-center justify-between">
                <span>{LINE_LABEL[line.type]}</span>
                <RialAmount value={line.settledRial} rate1000={resultRate1000} />
              </li>
            ))}
          </ul>
          <Button size="action" className="w-full" onClick={resetForm}>
            تسویه‌ی ترکیبی جدید
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {/* FE-099: مبلغ واردشده و ثبت‌نشده با ترک صفحه از بین می‌رود — هشدار پیش از آن */}
      <UnsavedChangesGuard when={lines.length > 0 || uncertain} submitting={isSubmitting} />
      <CardHeader>
        <CardTitle className="text-sm">تسویه‌ی ترکیبی</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => addLine('RIAL')}>
            + ریال
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => addLine('GOLD')}>
            + طلا
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => addLine('COIN')}>
            + سکه
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={availableCreditRial <= 0n || locked}
            onClick={() => addLine('CREDIT')}
          >
            + مانده اعتباری
          </Button>
        </div>

        {lines.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">هنوز ردیفی اضافه نشده.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line, index) => (
              /*
               * FE-092: هر ردیف یک گروه با نام یکتاست («ردیف ۲: ریال») تا دو فیلد «مبلغ» برای
               * صفحه‌خوان از هم جدا باشند، و خطای ردیف به همان گروه وصل است. حین ثبت کل ردیف
               * قفل است: درخواست در جریان با همین کلید idempotency است و تلاش دوباره نباید
               * مقدار دیگری بفرستد.
               */
              <fieldset
                key={line.id}
                disabled={locked}
                aria-label={`ردیف ${formatCount(index + 1)}: ${LINE_LABEL[line.type]}`}
                aria-describedby={errors[index] !== null ? `${line.id}-error` : undefined}
                className="min-w-0 space-y-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{LINE_LABEL[line.type]}</span>
                  <button
                    type="button"
                    aria-label={`حذف ردیف ${formatCount(index + 1)}: ${LINE_LABEL[line.type]}`}
                    className="-me-2 grid size-touch cursor-pointer place-items-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => removeLine(line.id)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>

                {line.type === 'RIAL' || line.type === 'CREDIT' ? (
                  <MoneyInput
                    label="مبلغ"
                    disabled={locked}
                    value={line.amountRial}
                    onChange={(value) => updateLine(line.id, { amountRial: value })}
                  />
                ) : null}

                {line.type === 'GOLD' ? (
                  <>
                    <WeightInput
                      label="وزن"
                      disabled={locked}
                      value={line.grossWeightMg}
                      onChange={(value) => updateLine(line.id, { grossWeightMg: value })}
                      karat={line.karat}
                    />
                    <KaratInput label="عیار" disabled={locked} value={line.karat} onChange={(value) => updateLine(line.id, { karat: value })} />
                  </>
                ) : null}

                {line.type === 'COIN' ? (
                  <>
                    <div className="space-y-1.5">
                      <label htmlFor={`${line.id}-coin-type`} className="text-xs font-medium text-muted-foreground">
                        نوع سکه
                      </label>
                      <Select
                        id={`${line.id}-coin-type`}
                        value={line.coinTypeId ?? ''}
                        onChange={(event) => updateLine(line.id, { coinTypeId: event.target.value || null })}
                      >
                        <option value="">انتخاب نوع سکه</option>
                        {activeCoinTypes.map((type) => (
                          <option key={type.coinTypeId} value={type.coinTypeId}>
                            {type.title}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <CountInput label="تعداد" disabled={locked} value={line.count} onChange={(value) => updateLine(line.id, { count: value })} />
                    <MoneyInput
                      label="نرخ بازار"
                      disabled={locked}
                      value={line.marketUnitPriceRial}
                      onChange={(value) => updateLine(line.id, { marketUnitPriceRial: value })}
                    />
                  </>
                ) : null}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">معادل نمایشی</span>
                  {previews[index] !== undefined && (rate1000 !== undefined || (line.type !== 'GOLD' && line.type !== 'COIN')) ? (
                    <RialAmount value={previews[index]!} rate1000={displayRate1000} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                {(line.type === 'GOLD' || line.type === 'COIN') && rate1000 !== undefined ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>نرخ ردیف</span>
                    <span className="tabular-nums">{formatRial(rate1000)} ریال/گرم</span>
                  </div>
                ) : null}

                {errors[index] !== null ? (
                  <p id={`${line.id}-error`} className="text-xs text-destructive">
                    {errors[index]}
                  </p>
                ) : null}
              </fieldset>
            ))}
          </div>
        )}

        <div className="space-y-1.5 border-t border-border pt-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">مانده اعتباری شخص</span>
            <RialAmount value={availableCreditRial} rate1000={displayRate1000} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">خلاصه پوشش بدهی</span>
            <span className="flex flex-wrap items-baseline justify-end gap-1 text-xs text-muted-foreground">
              {totalCoverage !== undefined ? <RialAmount value={totalCoverage} rate1000={displayRate1000} /> : '—'}
              {' از '}
              <RialAmount value={debtRial} rate1000={displayRate1000} />
            </span>
          </div>
          <div className="flex items-center justify-between font-medium">
            <span className="text-muted-foreground">باقی‌مانده</span>
            {remainingRial !== undefined ? (
              <RialAmount value={remainingRial} rate1000={displayRate1000} />
            ) : (
              <span className="tabular-nums">—</span>
            )}
          </div>
        </div>

        {error ? <ApiErrorNotice error={error} /> : null}
        <PendingSubmitNotice uncertain={uncertain} />

        <Button
          size="action"
          className="w-full"
          disabled={reason !== null || isSubmitting}
          onClick={() => void handleSubmit()}
        >
          {isSubmitting ? 'در حال ثبت…' : uncertain ? PENDING_SUBMIT_ACTION : 'ثبت تسویه‌ی ترکیبی'}
        </Button>
        {reason !== null ? <p className="text-center text-xs text-muted-foreground">{reason}</p> : null}
      </CardContent>
    </Card>
  );
}
