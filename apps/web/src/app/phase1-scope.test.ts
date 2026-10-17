import { describe, expect, it } from 'vitest';
import type { AnyRoute } from '@tanstack/react-router';
import { routeTree } from './router';

/**
 * FE-110 — «بدون ویژگی خارج فاز ۱» (بخش ۵ CLAUDE.md، بخش «خارج از دامنه» FrontTasks.md).
 *
 * ۱. **فهرست بسته‌ی مسیرها:** هر مسیر برنامه باید در `PHASE1_ROUTES` باشد. مسیر تازه این تست را
 *    می‌شکند تا کسی آگاهانه بپرسد «این داخل دامنه‌ی فاز ۱ است؟» — نه اینکه بی‌صدا اضافه شود.
 * ۲. **هیچ مسیری به ویژگی خارج دامنه اشاره نمی‌کند** (نقره، شمش، امانی، بازاریاب، پورسانت،
 *    چندشعبه‌ای، مرجوعی B2B، کارخانه، مؤدیان، باشگاه، RFID، ترازو، چک، اقساط، صف آفلاین).
 * مسیرهای `/_dev/*` فقط در توسعه‌اند و در بیلد production نیستند (`router.tsx`، `check-no-mocks.mjs`).
 */

const PHASE1_ROUTES = [
  '/',
  '/dashboard',
  '/forbidden',
  '/inventory',
  '/inventory/coins',
  '/inventory/jewelry',
  '/inventory/opening-balance',
  '/login',
  '/parties',
  '/parties/$partyId',
  '/parties/$partyId/settlements/new',
  '/parties/$partyId/statement',
  '/pricing',
  '/purchase/second-hand',
  '/purchase/second-hand/coins',
  '/reporting/creditors',
  '/reporting/debtors',
  '/reporting/profit',
  '/sales/coins/new',
  '/sales/invoices',
  '/sales/invoices/$invoiceId',
  '/sales/invoices/$invoiceId/amend',
  '/sales/invoices/$invoiceId/b2c-buyback',
  '/sales/new',
  '/settings',
  '/settings/coin-types',
  '/settings/general',
  '/settlements/new',
];

const OUT_OF_SCOPE =
  /silver|bullion|ingot|consign|marketer|commission|branch|b2b|return|factory|manufactur|moadian|tax|loyalty|club|rfid|scale|cheque|check|installment|offline|sync|webhook|graphql/iu;

function collectPaths(route: AnyRoute): string[] {
  const own = typeof route.fullPath === 'string' && route.fullPath !== '' ? [route.fullPath] : [];
  const children = route.children
    ? Array.isArray(route.children)
      ? route.children
      : Object.values(route.children)
    : [];
  return [...own, ...(children as AnyRoute[]).flatMap(collectPaths)];
}

const appPaths = [...new Set(collectPaths(routeTree as unknown as AnyRoute))]
  .filter((path) => !path.startsWith('/_dev/'))
  // مسیر بی‌مسیر ِ پوسته (layout) fullPath خالی یا ریشه دارد؛ ریشه خودش در فهرست هست
  .sort();

describe('FE-110 — دامنه‌ی فاز ۱', () => {
  it('هر مسیر برنامه دقیقاً همان فهرست بسته‌ی فاز ۱ است', () => {
    expect(appPaths).toEqual([...PHASE1_ROUTES].sort());
  });

  it('هیچ مسیری به ویژگی خارج از دامنه‌ی فاز ۱ اشاره نمی‌کند', () => {
    expect(appPaths.filter((path) => OUT_OF_SCOPE.test(path))).toEqual([]);
  });

  it('خود فیلتر خارج‌دامنه کار می‌کند', () => {
    for (const path of [
      '/inventory/silver',
      '/sales/b2b-returns',
      '/reporting/commission',
      '/parties/$id/cheques',
    ]) {
      expect(OUT_OF_SCOPE.test(path)).toBe(true);
    }
  });
});
