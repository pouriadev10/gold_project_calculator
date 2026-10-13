import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import {
  currentMockScenario,
  isMockScenario,
  MOCK_SCENARIOS,
  resetMockScenario,
  setMockScenario,
  type MockScenario,
} from './handlers/contract-gate';

/**
 * سرویس‌ورکر ساختگی — **فقط توسعه**.
 *
 * این ماژول عمداً هیچ‌جا به‌صورت ایستا `import` نمی‌شود. تنها مسیر
 * رسیدن به آن یک `import()` پویا در `main.tsx` است که داخل شرط
 * `import.meta.env.DEV` نشسته. در بیلد production آن شرط به `false`
 * تبدیل می‌شود و کل این شاخه — و msw همراهش — از درخت وابستگی حذف می‌شود.
 * `scripts/check-no-mocks.mjs` پس از هر بیلد همین را روی خروجی واقعی بررسی می‌کند.
 */
export const worker = setupWorker(...handlers);

/** سوییچ سناریو در توسعه: `?mockScenario=conflict` یا `__goldMocks.setScenario('network')` در کنسول. */
const SCENARIO_QUERY_PARAM = 'mockScenario';
const SCENARIO_STORAGE_KEY = 'gold.mockScenario';

function readStoredScenario(): string | null {
  try {
    return window.sessionStorage.getItem(SCENARIO_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeScenario(scenario: MockScenario): void {
  try {
    if (scenario === 'success') window.sessionStorage.removeItem(SCENARIO_STORAGE_KEY);
    else window.sessionStorage.setItem(SCENARIO_STORAGE_KEY, scenario);
  } catch {
    // ذخیره فقط راحتی توسعه است؛ بدون آن سناریو تا بارگذاری بعدی می‌ماند.
  }
}

function applyScenario(scenario: MockScenario, path?: string): void {
  setMockScenario(scenario, path === undefined ? {} : { path });
  storeScenario(scenario);
  console.info(`[msw] سناریوی mock: ${scenario}${path === undefined ? '' : ` ← ${path}`}`);
}

function installScenarioSwitch(): void {
  const requested = new URLSearchParams(window.location.search).get(SCENARIO_QUERY_PARAM) ?? readStoredScenario();
  if (isMockScenario(requested) && requested !== 'success') applyScenario(requested);

  Object.assign(window, {
    __goldMocks: {
      scenarios: MOCK_SCENARIOS,
      current: currentMockScenario,
      setScenario: (scenario: unknown, path?: string) => {
        if (!isMockScenario(scenario)) throw new Error(`سناریو باید یکی از ${MOCK_SCENARIOS.join('، ')} باشد`);
        applyScenario(scenario, path);
      },
      reset: () => {
        resetMockScenario();
        storeScenario('success');
      },
    },
  });
}

export async function startMockWorker(): Promise<void> {
  installScenarioSwitch();
  await worker.start({
    // درخواست‌هایی که handler ندارند (فونت، آیکون، HMR) دست‌نخورده رد شوند
    onUnhandledRequest: 'bypass',
    quiet: false,
  });
}
