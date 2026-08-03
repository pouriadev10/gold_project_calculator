/**
 * `dist/` خروجی CommonJS است، ولی این پکیج `"type": "module"` است.
 * بدون این نشانه، Node فایل‌های `dist/*.js` را ESM می‌بیند و اولین
 * `exports.x = ...` با خطای «exports is not defined» می‌شکند.
 *
 * یک package.json کوچک داخل `dist/` مرز را برای Node روشن می‌کند —
 * الگوی استاندارد بسته‌های dual-format. tsc نمی‌تواند پسوند `.cjs`
 * تولید کند مگر آنکه منبع `.cts` باشد، پس این ساده‌ترین راه است.
 */
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/package.json', import.meta.url), '{\n  "type": "commonjs"\n}\n');
