import { useState } from 'react';
import type { ReactNode } from 'react';
import { dualFromRial, formatGram, toSafeNumber } from '@gold/core-calc';
import type { JewelryWageType } from '@/api/contracts';
import { useJewelryItem } from '@/api/queries';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { InlineError } from '@/components/common/InlineError';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { KaratInput } from '@/components/keypad/KaratInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { PercentInput } from '@/components/keypad/PercentInput';
import { WeightInput } from '@/components/keypad/WeightInput';
import { useMazneh } from '@/features/home/useMazneh';
import type { SaleDraftItemLine, SaleLinePricingInput } from '@/stores/sale-draft-store';
import { calculateLinePricing, defaultPricingFromAdhoc, defaultPricingFromCatalog } from './sale-line-pricing';

/**
 * ویرایشگر مشخصات مالی یک ردیف فروش — FE-043.
 *
 * یک نمونه‌ی مشترک (مثل خودِ گفت‌وگوی «افزودن کالا» در `JewelryItemSelector`،
 * FE-042) — نه یک نمونه به‌ازای هر ردیف. کدام ردیف باز است را `line`
 * (از بیرون) تعیین می‌کند؛ `null` یعنی چیزی برای ویرایش نیست.
 *
 * ⚠️ **چرا دو کامپوننت، نه یکی با `useEffect` برای seed کردن مقدار اولیه:**
 * نسخه‌ی اول این فایل مقدار اولیه را با یک `useEffect` (بعد از mount)
 * روی فیلدها می‌نشاند. باگ واقعی پیدا شد: `NumericField` خودش یک effect
 * دارد که «مقدار فعلی را به فرم اطلاع بده» — این effect همان لحظه‌ی
 * mount هم یک‌بار با مقدار خامِ صفر (بافر خالی) صدا می‌زند. وقتی این
 * فیلدها *همان* رندری mount می‌شوند که مقدار seed‌شده هنوز از طریق
 * useEffect نرسیده، آن اعلان صفرِ خودِ NumericField، مقدار seed‌شده را
 * دوباره با صفر بازنویسی می‌کرد — یک مسابقه‌ی بی‌صدا که هرگز خودش را
 * اصلاح نمی‌کرد. راه‌حل: فیلدها اصلاً mount نشوند تا `initialPricing`
 * آماده باشد؛ کامپوننت داخلی (`SaleLinePricingForm`) با `key={line.lineId}`
 * فقط وقتی رندر می‌شود که مقدار اولیه‌ی واقعی در دست است — همان الگوی
 * اثبات‌شده‌ی `JewelryItemFormDialog.tsx` (`useState(item ? ... : 0n)`،
 * مقدار درست از همان رندر اول، نه بعد از mount).
 *
 * مقدار اولیه: اگر `line.pricing` قبلاً ست شده (ویرایش دوباره)، همان.
 * وگرنه برای `ADHOC` از وزن/عیارِ «ورود سریع» FE-042
 * (`defaultPricingFromAdhoc`)، برای `CATALOG` از آخرین نسخه‌ی کالا
 * (`GET /inventory/jewelry-items/:id`، `useJewelryItem`، تازه در این تسک).
 *
 * پیش‌نمایش با `calculateLinePricing` (`sale-line-pricing.ts`) روی **هر**
 * تغییر فیلد زنده محاسبه می‌شود — نه فقط لحظه‌ی ذخیره — و نتیجه هرگز
 * ذخیره نمی‌شود؛ فقط `SaleLinePricingInput` (ورودی خام) با «ذخیره» به
 * بیرون داده می‌شود. اگر کسورات از وزن ناخالص بیشتر شود، همان خطای واقعی
 * `calculateJewelrySale` نمایش داده می‌شود، نه یک اعتبارسنجی محلی جدا —
 * همان الگوی `JewelryItemFormDialog.tsx` (FE-036/037).
 *
 * ⚠️ این کامپوننت خودش `<NumericKeypad />` رندر نمی‌کند — `SaleWizardPage`
 * از قبل دقیقاً یک نمونه دارد (FE-042).
 */

const WAGE_TYPE_LABEL: Record<JewelryWageType, string> = {
  PER_GRAM: 'ریال به ازای هر گرم',
  PERCENT_X100: 'درصدی از ارزش طلا',
  FLAT: 'مبلغ ثابت',
};

function PreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

interface SaleLinePricingFormProps {
  line: SaleDraftItemLine;
  initialPricing: SaleLinePricingInput;
  onSave: (pricing: SaleLinePricingInput) => void;
  onCancel: () => void;
}

/** بدنه‌ی واقعی فرم — همیشه با مقدار اولیه‌ی کامل mount می‌شود (نگاه کنید به کامنت بالای فایل). */
function SaleLinePricingForm({ initialPricing, onSave, onCancel }: SaleLinePricingFormProps) {
  const mazneh = useMazneh();

  const [grossWeightMg, setGrossWeightMg] = useState(BigInt(initialPricing.grossWeightMg));
  const [karatValue, setKaratValue] = useState(BigInt(initialPricing.karat));
  const [stoneWeightMg, setStoneWeightMg] = useState(BigInt(initialPricing.stoneWeightMg));
  const [otherDeductionWeightMg, setOtherDeductionWeightMg] = useState(
    BigInt(initialPricing.otherDeductionWeightMg),
  );
  const [wageType, setWageType] = useState<JewelryWageType>(initialPricing.wageType);
  const [wageValue, setWageValue] = useState(BigInt(initialPricing.wageValue));
  const [profitRateBps, setProfitRateBps] = useState(BigInt(initialPricing.profitRateBps));
  const [taxRateBps, setTaxRateBps] = useState(BigInt(initialPricing.taxRateBps));

  const onWageTypeChange = (next: JewelryWageType) => {
    setWageType(next);
    // مقیاس مقدار قبلی برای نوع تازه بی‌معناست — همان قاعده‌ی JewelryItemFormDialog
    setWageValue(0n);
  };

  const currentPricing: SaleLinePricingInput = {
    grossWeightMg: grossWeightMg.toString(),
    karat: toSafeNumber(karatValue),
    stoneWeightMg: stoneWeightMg.toString(),
    otherDeductionWeightMg: otherDeductionWeightMg.toString(),
    wageType,
    wageValue: wageValue.toString(),
    profitRateBps: profitRateBps.toString(),
    taxRateBps: taxRateBps.toString(),
  };

  const calcResult = mazneh.data ? calculateLinePricing(currentPricing, mazneh.data.mazneh) : undefined;
  const rate1000 = mazneh.data?.gram1000;

  const canSave = grossWeightMg > 0n && karatValue >= 1n && karatValue <= 1000n && calcResult?.ok === true;

  return (
    <>
      <div className="space-y-4">
        <WeightInput label="وزن ناخالص" value={grossWeightMg} onChange={setGrossWeightMg} />
        <KaratInput label="عیار" value={karatValue} onChange={setKaratValue} />
        <WeightInput label="وزن نگین" value={stoneWeightMg} onChange={setStoneWeightMg} />
        <WeightInput
          label="سایر کسورات"
          value={otherDeductionWeightMg}
          onChange={setOtherDeductionWeightMg}
        />

        <div>
          <label htmlFor="sale-line-wage-type" className="mb-1.5 block text-sm font-medium">
            نوع اجرت
          </label>
          <Select
            id="sale-line-wage-type"
            value={wageType}
            onChange={(event) => onWageTypeChange(event.target.value as JewelryWageType)}
          >
            {Object.entries(WAGE_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {wageType === 'PERCENT_X100' ? (
          <PercentInput label="مقدار اجرت" value={wageValue} onChange={setWageValue} />
        ) : (
          <MoneyInput
            label="مقدار اجرت"
            value={wageValue}
            onChange={setWageValue}
            {...(wageType === 'PER_GRAM' && { hint: 'به ازای هر گرم وزن مشمول' })}
          />
        )}

        <PercentInput label="درصد سود" value={profitRateBps} onChange={setProfitRateBps} />
        <PercentInput label="درصد مالیات" value={taxRateBps} onChange={setTaxRateBps} />

        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          {calcResult === undefined ? (
            <p className="text-xs text-muted-foreground">برای پیش‌نمایش، ابتدا مظنه باید ثبت شده باشد.</p>
          ) : !calcResult.ok ? (
            <InlineError message={calcResult.error} />
          ) : (
            <>
              <PreviewRow label="وزن خالص">
                <span className="text-sm tabular-nums">{formatGram(calcResult.calc.pureWeightMg)}</span>
              </PreviewRow>
              <PreviewRow label="نرخ گرم">
                <RateDisplay value={calcResult.calc.goldRatePerGramRial} size="sm" />
              </PreviewRow>
              {rate1000 !== undefined ? (
                <>
                  <PreviewRow label="ارزش طلا">
                    <AmountDisplay amount={dualFromRial(calcResult.calc.goldValueRial, rate1000)} size="sm" />
                  </PreviewRow>
                  <PreviewRow label="اجرت">
                    <AmountDisplay amount={dualFromRial(calcResult.calc.wageRial, rate1000)} size="sm" />
                  </PreviewRow>
                  <PreviewRow label="سود">
                    <AmountDisplay amount={dualFromRial(calcResult.calc.profitRial, rate1000)} size="sm" />
                  </PreviewRow>
                  <PreviewRow label="مالیات">
                    <AmountDisplay amount={dualFromRial(calcResult.calc.taxRial, rate1000)} size="sm" />
                  </PreviewRow>
                  <PreviewRow label="مبلغ کل">
                    <AmountDisplay amount={dualFromRial(calcResult.calc.payableRial, rate1000)} size="lg" />
                  </PreviewRow>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          انصراف
        </Button>
        <Button type="button" disabled={!canSave} onClick={() => canSave && onSave(currentPricing)}>
          ذخیره
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}

export interface SaleLinePricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ردیفی که ویرایش می‌شود؛ `null` یعنی چیزی باز نیست. */
  line: SaleDraftItemLine | null;
  onSave: (pricing: SaleLinePricingInput) => void;
}

export function SaleLinePricingDialog({ open, onOpenChange, line, onSave }: SaleLinePricingDialogProps) {
  const needsCatalogFetch = line?.kind === 'CATALOG' && line.pricing === null;
  const catalogQuery = useJewelryItem(needsCatalogFetch ? line.jewelryItemId : null);

  const initialPricing: SaleLinePricingInput | undefined =
    line === null
      ? undefined
      : (line.pricing ??
        (line.kind === 'ADHOC'
          ? defaultPricingFromAdhoc(line)
          : catalogQuery.data
            ? defaultPricingFromCatalog(catalogQuery.data)
            : undefined));

  const close = () => onOpenChange(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{line ? `ویرایش قیمت — ${line.title}` : 'ویرایش قیمت'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            وزن، عیار، کسورات، اجرت، سود و مالیات این ردیف را تنظیم کنید — پیش‌نمایش زیر بلافاصله به‌روز می‌شود.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {needsCatalogFetch && catalogQuery.isLoading ? (
          <>
            <p className="text-sm text-muted-foreground">در حال دریافت مشخصات کالا...</p>
            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                انصراف
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : needsCatalogFetch && catalogQuery.isError ? (
          <>
            <InlineError message="دریافت مشخصات کالا ناموفق بود." />
            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                انصراف
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : line !== null && initialPricing !== undefined ? (
          <SaleLinePricingForm
            key={line.lineId}
            line={line}
            initialPricing={initialPricing}
            onSave={onSave}
            onCancel={close}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
