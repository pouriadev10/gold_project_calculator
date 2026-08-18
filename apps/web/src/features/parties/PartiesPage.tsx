import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Party, PartyListQuery, PartyStatus, PartyType } from '@/api/contracts';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CreatePartyDialog } from './CreatePartyDialog';
import { PartyFormDialog } from './PartyFormDialog';
import { PartyList } from './PartyList';

/**
 * صفحه‌ی اشخاص — FE-032 + FE-033.
 *
 * جست‌وجو با ۳۰۰ms تأخیر منتشر می‌شود (`useDebouncedValue`) تا هر ضربه‌ی
 * کیبورد یک درخواست تازه نسازد. تغییر هر فیلتر (جست‌وجو، نوع، وضعیت)
 * صفحه را به اول برمی‌گرداند — وگرنه کاربر ممکن است روی صفحه‌ی ۳ بماند
 * درحالی‌که فیلتر تازه اصلاً به آن تعداد نتیجه نمی‌رسد.
 *
 * دکمه‌ی «افزودن شخص» با همان الگوی منطقه‌ی شست `HomePage.tsx` است —
 * ثابت، دقیقاً بالای نوار ناوبری، همیشه بدون اسکرول در دسترس. عمداً هنوز
 * همان `CreatePartyDialog` سریع سه‌فیلدی FE-032 را باز می‌کند، نه فرم
 * کامل — متن خودِ آن گفت‌وگو همین را می‌گوید: «بقیه‌ی مشخصات را بعداً از
 * صفحه‌ی شخص کامل کنید». آن «بعداً» همین‌جاست: دکمه‌ی ویرایش روی هر ردیف
 * `PartyList`، `PartyFormDialog` (FE-033) را با همه‌ی پنج فیلد برای همان
 * شخص باز می‌کند. `editingParty` را نه ID، بلکه خودِ شیء `Party` نگه
 * می‌دارد — چون هیچ `useParty(id)` یا route جزئیات واقعی هنوز نیست
 * (FE-034)؛ ردیفِ همین لیست تنها منبع داده‌ی در دسترس است.
 */

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const TYPE_LABEL: Record<PartyType, string> = { CONSUMER: 'مصرف‌کننده', BUSINESS: 'همکار' };
const STATUS_LABEL: Record<PartyStatus, string> = { ACTIVE: 'فعال', INACTIVE: 'غیرفعال' };

export default function PartiesPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<PartyType | ''>('');
  const [status, setStatus] = useState<PartyStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();

  const query: PartyListQuery = {
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(type && { type }),
    ...(status && { status }),
    limit: PAGE_SIZE,
    offset,
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="اشخاص" />

      <div className="flex-1 space-y-4 p-4 pb-action">
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              inputMode="search"
              placeholder="جست‌وجوی نام یا موبایل"
              aria-label="جست‌وجوی اشخاص"
              className="ps-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              aria-label="فیلتر نوع"
              value={type}
              onChange={(event) => {
                setType(event.target.value as PartyType | '');
                setOffset(0);
              }}
            >
              <option value="">همه‌ی انواع</option>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="فیلتر وضعیت"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PartyStatus | '');
                setOffset(0);
              }}
            >
              <option value="">همه‌ی وضعیت‌ها</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <PartyList query={query} onOffsetChange={setOffset} onEdit={setEditingParty} />
      </div>

      {/* منطقه‌ی شست — همان الگوی HomePage.tsx: ثابت، دقیقاً بالای نوار ناوبری */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:px-4 lg:pb-4">
        <Button type="button" size="action" onClick={() => setCreateOpen(true)}>
          <Plus className="size-5" aria-hidden="true" />
          افزودن شخص
        </Button>
      </div>

      <CreatePartyDialog open={createOpen} onOpenChange={setCreateOpen} />

      {editingParty ? (
        <PartyFormDialog
          key={editingParty.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditingParty(null);
          }}
          party={editingParty}
        />
      ) : null}
    </div>
  );
}
