import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/**
 * گزارش ترکیب بسته — FE-087.
 *
 * Rollup اندازه‌ی رندرشده‌ی هر ماژول را داخل هر چانک می‌داند؛ این افزونه همان را
 * بی‌هیچ وابستگی تازه‌ای در `apps/web/build/bundle-report.json` می‌نویسد (نه در `dist`،
 * تا نام ماژول‌ها روی سرور production منتشر نشود):
 *
 * - هر چانک: gzip، خام، اولیه‌بودن (ورودی + هر چه ایستا از آن import می‌شود، یعنی
 *   آنچه پیش از اولین رنگ دانلود می‌شود) یا تنبل‌بودن؛
 * - سهم هر بسته‌ی npm و هر بخش کد خودمان، جدا برای بسته‌ی اولیه؛
 * - بسته‌هایی که با **دو نسخه‌ی متفاوت** هم‌زمان در خروجی آمده‌اند.
 *
 * `scripts/check-bundle-size.mjs` همین گزارش را می‌خواند، در خروجی CI خلاصه
 * می‌کند و نسخه‌ی تکراری را شکست حساب می‌کند.
 */

export interface BundleReportChunk {
  readonly fileName: string;
  readonly initial: boolean;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  /** سهم هر بسته/بخش از این چانک، بزرگ‌ترین اول. */
  readonly groups: ReadonlyArray<{ readonly name: string; readonly bytes: number }>;
}

export interface BundleReport {
  readonly generatedAt: string;
  readonly chunks: readonly BundleReportChunk[];
  /** سهم هر بسته/بخش در کل بسته‌ی اولیه، بزرگ‌ترین اول. */
  readonly initialGroups: ReadonlyArray<{ readonly name: string; readonly bytes: number }>;
  /** بسته‌هایی که بیش از یک نسخه‌شان در خروجی است. */
  readonly duplicates: ReadonlyArray<{ readonly name: string; readonly versions: readonly string[] }>;
}

/**
 * آخرین `node_modules/<بسته>/` در مسیر. pnpm نام پوشه‌های بلند را hash می‌کند
 * (`@radix-ui+react-collection@_e568…`)، پس نسخه از مسیر قابل خواندن نیست.
 */
const LAST_PACKAGE = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//u;

const versionCache = new Map<string, string | undefined>();

/** نسخه‌ی واقعی از package.json همان پوشه‌ی بسته. */
function packageVersion(packageDir: string): string | undefined {
  if (!versionCache.has(packageDir)) {
    try {
      const manifest = JSON.parse(readFileSync(`${packageDir}/package.json`, 'utf8')) as { version?: string };
      versionCache.set(packageDir, manifest.version);
    } catch {
      versionCache.set(packageDir, undefined);
    }
  }
  return versionCache.get(packageDir);
}

/** شناسه‌ی ماژول → «بسته» (npm، با نسخه‌ی واقعی) یا بخش کد خودمان. */
export function classifyModule(id: string): { readonly group: string; readonly packageName?: string; readonly version?: string } {
  const path = id.replace(/\\/gu, '/').replace(/^\0/u, '').replace(/\?.*$/u, '');
  const inPackage = LAST_PACKAGE.exec(path);
  if (inPackage) {
    const version = packageVersion(inPackage[1]!);
    return { group: inPackage[2]!, packageName: inPackage[2]!, ...(version ? { version } : {}) };
  }
  const workspace = /\/packages\/([^/]+)\//u.exec(path);
  if (workspace) return { group: `@gold/${workspace[1]!}` };
  const app = /\/src\/([^/]+)(?:\/([^/]+))?/u.exec(path);
  if (app) return { group: app[1] === 'features' && app[2] ? `app:features/${app[2]}` : `app:${app[1]!}` };
  return { group: 'other' };
}

function sortedGroups(map: Map<string, number>) {
  return [...map.entries()].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
}

/** مسیر گزارش نسبت به ریشه‌ی `apps/web`. */
export const BUNDLE_REPORT_PATH = join('build', 'bundle-report.json');

export function bundleReport(): Plugin {
  let root = process.cwd();
  return {
    name: 'gold-bundle-report',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

      // بسته‌ی اولیه: ورودی‌ها و هر import ایستای آن‌ها (همان modulepreloadها).
      const initial = new Set<string>();
      const queue = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
      while (queue.length > 0) {
        const fileName = queue.pop()!;
        if (initial.has(fileName)) continue;
        initial.add(fileName);
        for (const imported of byFile.get(fileName)?.imports ?? []) queue.push(imported);
      }

      const initialGroups = new Map<string, number>();
      const versions = new Map<string, Set<string>>();
      const reportChunks: BundleReportChunk[] = chunks.map((chunk) => {
        const groups = new Map<string, number>();
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (info.renderedLength === 0) continue;
          const { group, packageName, version } = classifyModule(id);
          groups.set(group, (groups.get(group) ?? 0) + info.renderedLength);
          if (initial.has(chunk.fileName)) {
            initialGroups.set(group, (initialGroups.get(group) ?? 0) + info.renderedLength);
          }
          if (packageName && version) {
            versions.set(packageName, (versions.get(packageName) ?? new Set()).add(version));
          }
        }
        return {
          fileName: chunk.fileName,
          initial: initial.has(chunk.fileName),
          rawBytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code, { level: 9 }).length,
          groups: sortedGroups(groups),
        };
      });

      const report: BundleReport = {
        generatedAt: new Date().toISOString(),
        chunks: reportChunks.sort((a, b) => (a.initial === b.initial ? b.gzipBytes - a.gzipBytes : a.initial ? -1 : 1)),
        initialGroups: sortedGroups(initialGroups),
        duplicates: [...versions.entries()]
          .filter(([, set]) => set.size > 1)
          .map(([name, set]) => ({ name, versions: [...set].sort() })),
      };

      const target = join(root, BUNDLE_REPORT_PATH);
      mkdirSync(join(root, 'build'), { recursive: true });
      writeFileSync(target, JSON.stringify(report, null, 2));
    },
  };
}
