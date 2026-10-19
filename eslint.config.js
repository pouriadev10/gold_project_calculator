// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * قواعد سراسری پروژه — بخش ۱ و ۴ فایل BOOTSTRAP.md
 *
 * پنج خانواده‌ی ممنوعیت:
 *   ۱. گرد کردن خارج از core-calc/src/rounding.ts
 *   ۲. parseFloat (و هر مسیر تبدیل شناور)
 *   ۳. کلاس‌های جهت‌دار Tailwind (RTL)
 *   ۴. رنگ hex خام در JSX
 *   ۵. ایمپورت مستقیم از apps/api (FE-003) — مرز اپ‌ها فقط از packages/contracts رد می‌شود
 */

const NUMBER_CALL_SELECTOR = "CallExpression[callee.name='Number']";

/** ۱ + ۲ — گرد کردن و شناور. در همه‌جا جز rounding.ts ممنوع. */
const noFloatMath = [
  {
    selector:
      "MemberExpression[object.name='Math'][property.name=/^(round|floor|ceil|trunc)$/]",
    message:
      'گرد کردن فقط در packages/core-calc/src/rounding.ts مجاز است. از roundHalfUp استفاده کن.',
  },
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: 'parseFloat ممنوع است — پول و وزن با bigint نگه‌داری می‌شوند.',
  },
  {
    selector: "MemberExpression[object.name='Number'][property.name='parseFloat']",
    message: 'Number.parseFloat ممنوع است — پول و وزن با bigint نگه‌داری می‌شوند.',
  },
  {
    selector: "MemberExpression[property.name='toFixed']",
    message: 'toFixed ممنوع است — قالب‌بندی مالی از core-calc/format.ts می‌آید.',
  },
  {
    // `Number()` روی ورودی کاربر دقت را بی‌صدا از بین می‌برد.
    // تنها نقطه‌ی مجاز تبدیل: core-calc/src/number-bridge.ts
    selector: NUMBER_CALL_SELECTOR,
    message:
      'Number() ممنوع است — برای تبدیل bigint از toSafeNumber در core-calc استفاده کن.',
  },
];

/**
 * ۳ — کلاس‌های جهت‌دار Tailwind. باید ms-/me-/ps-/pe-/start-/end- باشند.
 *
 * مرز ابتدای کلاس شامل `:` هم هست، وگرنه واریانت‌ها از تور رد می‌شوند:
 * `sm:text-left` و `lg:ml-4` هم باید بگیرند، نه فقط شکل بی‌پیشوند.
 *
 * FE-083: گوشه‌های گرد تکی (`rounded-tl-`…)، `float-left/right`، فاصله‌ی
 * اسکرول و انیمیشن‌های لغزشی (`slide-in-from-left`…) هم جهت‌دارند و اضافه
 * شدند. استثنا فقط کلاسی است که صریحاً با `rtl:` یا `ltr:` محدود شده —
 * آن کلاس عمداً برای یک جهت نوشته شده (مثل انیمیشن لغزش `sheet.tsx`).
 */
const CLASS_BOUNDARY = `(^|[\\s"'\`]|(?<!(rtl|ltr)):)`;
const DIRECTIONAL_CLASS = new RegExp(
  `${CLASS_BOUNDARY}(-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|inset-l|inset-r|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-|(text|float)-(left|right)(\\s|$|["'\`])|slide-(in-from|out-to)-(left|right))`,
);

/** ۴ — رنگ hex خام. */
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;

const noDirectionalClasses = [
  {
    selector: `Literal[value=${DIRECTIONAL_CLASS.toString()}]`,
    message:
      'کلاس جهت‌دار ممنوع (RTL). به‌جای ml-/mr-/pl-/pr-/left-/right-/text-left/text-right/rounded-tl-… از ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-ss-… استفاده کن؛ برای انیمیشن لغزش صریحاً rtl:/ltr: بنویس.',
  },
  {
    selector: `TemplateElement[value.raw=${DIRECTIONAL_CLASS.toString()}]`,
    message:
      'کلاس جهت‌دار ممنوع (RTL). به‌جای ml-/mr-/pl-/pr-/left-/right-/text-left/text-right/rounded-tl-… از ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-ss-… استفاده کن؛ برای انیمیشن لغزش صریحاً rtl:/ltr: بنویس.',
  },
];

const noRawHex = [
  {
    selector: `Literal[value=${RAW_HEX.toString()}]`,
    message: 'رنگ hex خام ممنوع است. فقط توکن‌های Tailwind.',
  },
  {
    selector: `TemplateElement[value.raw=${RAW_HEX.toString()}]`,
    message: 'رنگ hex خام ممنوع است. فقط توکن‌های Tailwind.',
  },
];

/**
 * ۵ — ایمپورت مستقیم از apps/api.
 *
 * فرانت فقط باید از طریق packages/contracts با شکل داده‌ی بک‌اند آشنا شود.
 * هم نام پکیج (`@gold/api`) و هم مسیر نسبی‌ای که به‌زور به داخل apps/api/
 * سرک بکشد را می‌گیرد — یکی جلوی import رسمی را می‌گیرد، دیگری جلوی
 * دورزدنش با `../../apps/api/src/...` را.
 */
const NO_API_IMPORT_PATTERNS = [
  {
    group: ['@gold/api', '@gold/api/*', '**/apps/api/**'],
    message:
      'ایمپورت مستقیم از apps/api ممنوع است — قرارداد مشترک باید از packages/contracts بیاید.',
  },
];

/**
 * ۶ — import کل یک کتابخانه‌ی بزرگ (FE-087). tree-shaking این‌ها را نمی‌بُرد، پس هر
 * import ریشه کل کتابخانه را به چانک می‌آورد. ECharts فقط از راه `echarts/core` و
 * قطعه‌های لازم (`echarts/charts`، `echarts/components`، `echarts/renderers`) — نمونه:
 * `features/reporting/profit-trend-echarts.ts`.
 */
const WHOLE_LIBRARY_IMPORTS = [
  {
    name: 'echarts',
    message:
      'import ریشه‌ی echarts کل کتابخانه را می‌آورد — از echarts/core و فقط قطعه‌های لازم استفاده کن (مثل profit-trend-echarts.ts).',
  },
  { name: 'lodash', message: 'lodash کامل ممنوع است — تابع بومی یا lodash-es/<تابع>.' },
  { name: 'moment', message: 'moment سنگین و غیرقابل tree-shake است — از lib/date و date-fns-jalali استفاده کن.' },
  {
    name: 'echarts-for-react',
    message: 'echarts-for-react کل ECharts را می‌کشد و با StrictMode ناسازگار است — API مستقیم echarts/core (FE-076).',
  },
  {
    name: 'lucide-react',
    importNames: ['icons'],
    message: '`icons` کل مجموعه‌ی آیکون را وارد بسته می‌کند — هر آیکون را نام‌دار import کن.',
  },
];

/**
 * ECharts باید در چانک تنبل نمودار بماند: `echarts/*` و `zrender` فقط در
 * `profit-trend-echarts.ts`، و آن ماژول هم فقط با `import()` پویا — import ایستایش
 * (جز `import type`) ECharts را به چانک صفحه می‌کشید.
 */
const CHART_STAYS_LAZY_PATTERNS = [
  {
    group: ['echarts/*', 'zrender', 'zrender/*'],
    message: 'ECharts فقط در features/reporting/profit-trend-echarts.ts (چانک تنبل) import می‌شود.',
  },
  {
    group: ['**/profit-trend-echarts'],
    allowTypeImports: true,
    message: 'ماژول نمودار فقط با import() پویا بارگذاری می‌شود؛ import type مجاز است.',
  },
];

/**
 * ۷ — mock مالی فقط توسعه و تست (FE-093). تنها راه رسیدن کد برنامه به `src/mocks` یک
 * `import()` پویا زیر `import.meta.env.DEV` در `main.tsx` است (این قاعده import پویا را
 * نمی‌گیرد). import ایستا — حتی یک fixture — داده‌ی ساختگی را به باندل production می‌برد؛
 * `scripts/check-no-mocks.mjs` همین را پس از بیلد روی خروجی واقعی هم بررسی می‌کند.
 */
const MOCKS_STAY_DEV_ONLY_PATTERNS = [
  {
    group: ['@/mocks', '@/mocks/*', '**/mocks/*', 'msw', 'msw/*'],
    message: 'mock و msw فقط در تست‌ها و import() پویای DEV در main.tsx — نه در کد برنامه.',
  },
];

/** `import * as Icons from 'lucide-react'` همه‌ی آیکون‌ها را می‌آورد؛ فقط import نام‌دار. */
const noWholeIconSet = [
  {
    selector: "ImportDeclaration[source.value='lucide-react'] > ImportNamespaceSpecifier",
    message: "import * از lucide-react همه‌ی آیکون‌ها را به بسته می‌آورد — آیکون‌ها را نام‌دار import کن.",
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/.claude/**',
      '**/design-system/**',
      // سرویس‌ورکر تولیدشده‌ی msw — فایل vendor است، ما نگهش نمی‌داریم
      '**/public/mockServiceWorker.js',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.cjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', ...noFloatMath],
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'parseFloat ممنوع است — از bigint استفاده کن.' },
      ],
      'no-restricted-imports': ['error', { patterns: NO_API_IMPORT_PATTERNS }],
    },
  },

  // دو استثنای واحد: خانه‌ی رسمی گرد کردن، و پل bigint→number
  {
    files: ['packages/core-calc/src/rounding.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // پل فقط از ممنوعیت `Number()` معاف است — گرد کردن آنجا هم ممنوع می‌ماند (CLAUDE.md ۲-۱).
  {
    files: ['packages/core-calc/src/number-bridge.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noFloatMath.filter((restriction) => restriction.selector !== NUMBER_CALL_SELECTOR),
      ],
    },
  },

  // apps/api از قاعده‌ی ۵ مستثناست — ایمپورت‌های داخلی‌اش نسبی‌اند و اصلاً با این الگوها نمی‌خورند؛
  // این استثنا صریح است تا اگر روزی رفتار glob فرق کرد، غافلگیر نشویم.
  {
    files: ['apps/api/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  /*
   * ابزارهای بیلد.
   *
   * این‌ها هرگز به مقدار دامنه (پول، وزن، عیار) دست نمی‌زنند — فقط
   * کیلوبایت را برای چاپ در ترمینال گرد می‌کنند. ممنوعیت `toFixed`
   * برای جلوگیری از قالب‌بندی شناور مبالغ است، نه برای گزارش حجم فایل.
   * دامنه‌ی استثنا عمداً به `scripts/` محدود است و شامل هیچ کد اپلیکیشنی نمی‌شود.
   */
  {
    files: ['scripts/**/*.{mjs,js}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // فایل‌های UI: علاوه بر قواعد بالا، جهت و رنگ هم کنترل می‌شود
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        ...noFloatMath,
        ...noDirectionalClasses,
        ...noRawHex,
        ...noWholeIconSet,
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [...NO_API_IMPORT_PATTERNS, ...CHART_STAYS_LAZY_PATTERNS, ...MOCKS_STAY_DEV_ONLY_PATTERNS],
          paths: WHOLE_LIBRARY_IMPORTS,
        },
      ],
      // FE-101: هیچ log ِ DevTools در کد برنامه — توکن، کد ملی و بدنه‌ی مالی راحت به کنسول می‌رسند.
      // استثنای عمدی فقط با `eslint-disable-next-line` و دلیل؛ بیلد production هم console را حذف می‌کند.
      'no-console': 'error',
      // FE-006: هر درخواست شبکه باید از apiGet/apiPost عبور کند تا Idempotency-Key،
      // timeout و اعتبارسنجی zod هیچ‌جا فراموش نشوند.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'parseFloat ممنوع است — از bigint استفاده کن.' },
        {
          name: 'fetch',
          message: 'fetch مستقیم ممنوع است — از apiGet/apiPost در @/api/client استفاده کن.',
        },
      ],
    },
  },

  // تنها خانه‌ی ECharts — خودش با import() پویا از ProfitTrendChart بارگذاری می‌شود.
  {
    files: ['apps/web/src/features/reporting/profit-trend-echarts.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...NO_API_IMPORT_PATTERNS, ...MOCKS_STAY_DEV_ONLY_PATTERNS], paths: WHOLE_LIBRARY_IMPORTS },
      ],
    },
  },

  // خود mockها msw و fixtureهایشان را import می‌کنند؛ فقط از راه import() پویای DEV به برنامه می‌رسند.
  // (فقط-توسعه است، پس log ِ راه‌اندازی msw مجاز است.)
  {
    files: ['apps/web/src/mocks/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      'no-restricted-imports': [
        'error',
        { patterns: [...NO_API_IMPORT_PATTERNS, ...CHART_STAYS_LAZY_PATTERNS], paths: WHOLE_LIBRARY_IMPORTS },
      ],
    },
  },

  // صفحه‌ی دودِ فقط-توسعه کل ECharts را عمداً بارگذاری می‌کند و در بیلد production نیست؛
  // تست‌ها هم در Node اجرا می‌شوند و هرگز به بسته نمی‌رسند؛ `src/test/` (setup و زیرساخت
  // Integration، FE-095) هم فقط از تست‌ها import می‌شود — `check-no-mocks.mjs` خروجی بیلد را می‌سنجد.
  {
    files: [
      'apps/web/src/features/dev/**/*.{ts,tsx}',
      'apps/web/**/*.test.{ts,tsx}',
      'apps/web/src/test/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: NO_API_IMPORT_PATTERNS }],
      'no-console': 'off',
    },
  },

  // لایه‌ی api/ تنها جایی است که مجاز است واقعاً fetch را صدا بزند
  {
    files: ['apps/web/src/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'parseFloat ممنوع است — از bigint استفاده کن.' },
      ],
    },
  },
);
