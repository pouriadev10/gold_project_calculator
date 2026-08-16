import { describe, expect, it } from 'vitest';
import { queryKeys } from './query-keys';

describe('queryKeys', () => {
  it('کلید هر query دقیقاً از all() همان بخش شروع می‌شود', () => {
    expect(queryKeys.pricing.latestQuote('MAZNEH')).toEqual([
      ...queryKeys.pricing.all(),
      'latest',
      'MAZNEH',
    ]);
    expect(queryKeys.pricing.history('MAZNEH')).toEqual([
      ...queryKeys.pricing.all(),
      'history',
      'MAZNEH',
    ]);
    expect(queryKeys.parties.balanceSummary()).toEqual([
      ...queryKeys.parties.all(),
      'balance-summary',
    ]);
    expect(queryKeys.parties.search('مهدی')).toEqual([...queryKeys.parties.all(), 'search', 'مهدی']);
    expect(queryKeys.items.search('x', 'coin')).toEqual([...queryKeys.items.all(), 'search', 'x', 'coin']);
    expect(queryKeys.transactions.recent(5)).toEqual([...queryKeys.transactions.all(), 'recent', 5]);
    expect(queryKeys.reports.profit('today')).toEqual([...queryKeys.reports.all(), 'profit', 'today']);
  });

  it('دو فراخوانی با آرگومان یکسان، کلید برابر (نه لزوماً همان reference) می‌دهند', () => {
    expect(queryKeys.parties.search('مهدی')).toEqual(queryKeys.parties.search('مهدی'));
    expect(queryKeys.parties.search('مهدی')).not.toBe(queryKeys.parties.search('مهدی'));
  });

  it('آرگومان‌های متفاوت کلید متفاوت می‌دهند', () => {
    expect(queryKeys.parties.search('مهدی')).not.toEqual(queryKeys.parties.search('زهرا'));
    expect(queryKeys.transactions.recent(5)).not.toEqual(queryKeys.transactions.recent(10));
  });

  it('all() هر بخش کوتاه‌ترین پیشوند مشترک همان بخش است', () => {
    expect(queryKeys.pricing.all()).toEqual(['pricing']);
    expect(queryKeys.parties.all()).toEqual(['parties']);
    expect(queryKeys.items.all()).toEqual(['items']);
    expect(queryKeys.transactions.all()).toEqual(['transactions']);
    expect(queryKeys.reports.all()).toEqual(['reports']);
  });
});
