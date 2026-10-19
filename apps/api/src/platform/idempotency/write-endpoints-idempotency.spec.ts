import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { isDocumentedPath } from '../openapi/openapi-document';
import { discoverRoutes, routeKey } from '../openapi/route-discovery';
import { isPublicPath } from '../request-context/request-path';
import type { DiscoveredRoute } from '../openapi/route-discovery';

const SRC = join(__dirname, '../..');
const REPO_ROOT = join(SRC, '../../..');
const RULE = 'write-endpoint-idempotency';

/**
 * مسیرهای نوشتنی ِ عمداً بدون `IdempotencyService`، با دلیل. هر ورودی باید
 * واقعاً مسیر نوشتنی موجود باشد و واقعاً از سرویس استفاده نکند — فهرست کهنه هم شکست است.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  'POST /sales/invoices/:invoiceId/b2c-buyback/preview':
    'فقط محاسبه و مقایسه؛ هیچ سندی ثبت نمی‌شود (b2c-buybacks.service previewInTransaction)',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function controllerFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

interface HandlerSource {
  readonly file: string;
  readonly line: number;
  readonly method: ts.MethodDeclaration;
  readonly source: ts.SourceFile;
}

function findHandler(controller: string, handler: string): HandlerSource {
  for (const file of controllerFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes(`class ${controller}`)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || statement.name?.text !== controller) continue;
      const method = statement.members.find(
        (member): member is ts.MethodDeclaration =>
          ts.isMethodDeclaration(member) && member.name.getText(source) === handler,
      );
      if (method !== undefined) {
        const line = source.getLineAndCharacterOfPosition(method.getStart(source)).line + 1;
        return { file: relative(REPO_ROOT, file).replace(/\\/gu, '/'), line, method, source };
      }
    }
  }
  throw new Error(`source of ${controller}.${handler} not found`);
}

/** نام پارامتری که با `@Headers(IDEMPOTENCY_KEY_HEADER)` گرفته شده. */
function idempotencyKeyParameter(handler: HandlerSource): string | undefined {
  for (const parameter of handler.method.parameters) {
    const decorators = ts.getDecorators(parameter) ?? [];
    if (decorators.some((decorator) => decorator.expression.getText(handler.source) === 'Headers(IDEMPOTENCY_KEY_HEADER)')) {
      return parameter.name.getText(handler.source);
    }
  }
  return undefined;
}

/**
 * آیا شیء ورودی `this.idempotency.execute(...)` کلید هدر را به‌عنوان **مقدار** دارد؟
 *
 * فقط `{ key }` یا `{ key: <پارامتر هدر> }` قبول است. جست‌وجوی متنی کافی نیست:
 * `{ key: undefined }` واژه‌ی key را دارد ولی idempotency را بی‌صدا خاموش می‌کند.
 */
function passesKeyToIdempotencyService(handler: HandlerSource, key: string): boolean {
  const carriesKey = (argument: ts.Expression): boolean =>
    ts.isObjectLiteralExpression(argument) &&
    argument.properties.some(
      (property) =>
        (ts.isShorthandPropertyAssignment(property) && property.name.text === key) ||
        (ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.initializer) &&
          property.initializer.text === key),
    );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(handler.source) === 'this.idempotency.execute' &&
      node.arguments.some(carriesKey)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  if (handler.method.body !== undefined) visit(handler.method.body);
  return found;
}

function violation(route: DiscoveredRoute): string | undefined {
  const handler = findHandler(route.controller, route.handler);
  const where = `${handler.file}:${handler.line} [${RULE}] ${routeKey(route)} (${route.controller}.${route.handler})`;
  const key = idempotencyKeyParameter(handler);

  if (key === undefined) {
    return `${where} — پارامتر @Headers(IDEMPOTENCY_KEY_HEADER) ندارد`;
  }
  if (!passesKeyToIdempotencyService(handler, key)) {
    return `${where} — کلید «${key}» را به this.idempotency.execute نمی‌دهد؛ تکرار درخواست سند دوم می‌سازد`;
  }
  return undefined;
}

/**
 * قانون: هر endpoint نوشتنی زیر مستأجر از `IdempotencyService` عبور می‌کند — BE-071.
 *
 * middleware فقط **وجود** هدر را اجبار می‌کند. اگر handler کلید را به سرویس ندهد،
 * کلاینتی که پس از قطع شبکه دوباره می‌فرستد فاکتور یا تسویه‌ی دوم ثبت می‌کند. این
 * آزمون منبع هر handler را می‌خواند و پیام شکستش مسیر فایل، خط و نام قانون را دارد.
 */
describe('هر endpoint نوشتنی idempotent است (BE-071)', () => {
  let writes: DiscoveredRoute[];

  beforeAll(() => {
    writes = discoverRoutes(AppModule).filter(
      (route) => WRITE_METHODS.has(route.method) && isDocumentedPath(route.path) && !isPublicPath(route.path),
    );
  });

  it('همه‌ی مسیرهای نوشتنی ِ مستأجر بررسی شده‌اند', () => {
    expect(writes.length).toBeGreaterThanOrEqual(25);
  });

  it('هیچ مسیر نوشتنی بدون عبور کلید به IdempotencyService', () => {
    const violations = writes
      .filter((route) => EXEMPT[routeKey(route)] === undefined)
      .map(violation)
      .filter((message): message is string => message !== undefined);

    expect(violations).toEqual([]);
  });

  it('استثناها کهنه نیستند: مسیرشان هست و واقعاً از سرویس استفاده نمی‌کنند', () => {
    for (const key of Object.keys(EXEMPT)) {
      const route = writes.find((candidate) => routeKey(candidate) === key);
      expect({ key, exists: route !== undefined }).toEqual({ key, exists: true });
      expect({ key, usesService: violation(route!) === undefined }).toEqual({ key, usesService: false });
    }
  });
});
