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
    selector: "CallExpression[callee.name='Number']",
    message:
      'Number() ممنوع است — برای تبدیل bigint از toSafeNumber در core-calc استفاده کن.',
  },
];

/**
 * ۳ — کلاس‌های جهت‌دار Tailwind. باید ms-/me-/ps-/pe-/start-/end- باشند.
 *
 * مرز ابتدای کلاس شامل `:` هم هست، وگرنه واریانت‌ها از تور رد می‌شوند:
 * `sm:text-left` و `lg:ml-4` هم باید بگیرند، نه فقط شکل بی‌پیشوند.
 */
const CLASS_BOUNDARY = `(^|[\\s"'\`:])`;
const DIRECTIONAL_CLASS = new RegExp(
  `${CLASS_BOUNDARY}(-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|inset-l|inset-r)-|text-(left|right)(\\s|$|["'\`]))`,
);

/** ۴ — رنگ hex خام. */
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;

const noDirectionalClasses = [
  {
    selector: `Literal[value=${DIRECTIONAL_CLASS.toString()}]`,
    message:
      'کلاس جهت‌دار ممنوع (RTL). به‌جای ml-/mr-/pl-/pr-/left-/right-/text-left/text-right از ms-/me-/ps-/pe-/start-/end-/text-start/text-end استفاده کن.',
  },
  {
    selector: `TemplateElement[value.raw=${DIRECTIONAL_CLASS.toString()}]`,
    message:
      'کلاس جهت‌دار ممنوع (RTL). به‌جای ml-/mr-/pl-/pr-/left-/right-/text-left/text-right از ms-/me-/ps-/pe-/start-/end-/text-start/text-end استفاده کن.',
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
    files: ['packages/core-calc/src/rounding.ts', 'packages/core-calc/src/number-bridge.ts'],
    rules: {
      'no-restricted-syntax': 'off',
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
      ],
    },
  },
);
