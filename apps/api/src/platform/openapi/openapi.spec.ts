import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { isPublicPath } from '../request-context/request-path';
import { buildOpenApiDocument, isDocumentedPath } from './openapi-document';
import { ROUTE_DOCS } from './route-docs';
import { discoverRoutes, routeKey } from './route-discovery';
import type { OpenApiDocument } from './openapi-document';
import type { DiscoveredRoute } from './route-discovery';

type Operation = {
  readonly operationId: string;
  readonly security: readonly Record<string, unknown>[];
  readonly parameters: readonly Record<string, unknown>[];
  readonly responses: Record<string, unknown>;
  readonly requestBody?: unknown;
};

/** کلیدهای پول و وزن — هرگز `number` در نمونه‌ها، نه خودشان و نه فرزندانشان (`before`/`after`). */
const MONEY_OR_WEIGHT_KEY =
  /(rial|amount|price|payable|paid|receivable|balance|wage|bubble|profit|tax|mg$|ug$|weight|quantity|mazneh)/iu;

/** واژه‌های دامنه‌ی خارج از فاز ۱ (CLAUDE.md بخش ۵) که نباید در هیچ مسیر مستندی باشند. */
const OUT_OF_SCOPE_PATH =
  /(silver|bullion|shemsh|ingot|marketer|commission|branch|consign|amanat|b2b|factory|manufactur|settlement-network|moadian|loyalty|club|rfid|cheque|check|offline|\/tax)/iu;

function operations(document: OpenApiDocument): [string, Operation][] {
  const paths = document['paths'] as Record<string, Record<string, Operation>>;
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]): [string, Operation] => [
      `${method.toUpperCase()} ${path}`,
      operation,
    ]),
  );
}

/** هر عدد JSON در نمونه‌ها، با کلید خودش و کلید والدش. */
function numbersInExamples(node: unknown, key = '', parent = '', inExample = false): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) => numbersInExamples(item, key, parent, inExample));
  }
  if (typeof node === 'number') {
    return inExample ? [`${parent}.${key}`] : [];
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  return Object.entries(node).flatMap(([child, value]) =>
    numbersInExamples(value, child, key, inExample || child === 'example'),
  );
}

describe('مستند OpenAPI (BE-070)', () => {
  let routes: DiscoveredRoute[];
  let documented: DiscoveredRoute[];
  let document: OpenApiDocument;

  beforeAll(() => {
    routes = discoverRoutes(AppModule);
    documented = routes.filter((route) => isDocumentedPath(route.path));
    document = buildOpenApiDocument(routes);
  });

  it('همه‌ی مسیرهای فاز ۱ مستندند و هیچ مستندی بدون مسیر واقعی نیست', () => {
    expect(Object.keys(ROUTE_DOCS).sort()).toEqual(documented.map(routeKey).sort());
    expect(operations(document).map(([key]) => key.replace(/\{(\w+)\}/gu, ':$1')).sort()).toEqual(
      documented.map(routeKey).sort(),
    );
    expect(documented.length).toBeGreaterThanOrEqual(58);
  });

  it('مسیرهای توسعه و هیچ مسیر خارج از فاز ۱ مستند نشده', () => {
    const paths = Object.keys(document['paths'] as object);

    expect(routes.some((route) => route.path.startsWith('/internal/dev'))).toBe(true);
    expect(paths.filter((path) => path.startsWith('/internal'))).toEqual([]);
    expect(paths.filter((path) => OUT_OF_SCOPE_PATH.test(path))).toEqual([]);
  });

  it('هیچ نمونه‌ای برای پول یا وزن JSON number ندارد', () => {
    const numeric = numbersInExamples(document);
    const offending = numeric.filter((path) =>
      path.split('.').some((segment) => MONEY_OR_WEIGHT_KEY.test(segment)),
    );

    expect(numeric.length).toBeGreaterThan(0);
    expect(offending).toEqual([]);
  });

  it('نمونه‌ی پول رشته‌ی عدد صحیح است', () => {
    const text = JSON.stringify(document);

    expect(text).toMatch(/"payableRial":"\d+"/u);
    expect(text).toMatch(/"amountRial":"\d+"/u);
  });

  it('هر نوشتن زیر مستأجر Idempotency-Key و هر مسیر محافظت‌شده bearer و هدر مستأجر دارد', () => {
    for (const route of documented) {
      const [, operation] = operations(document).find(
        ([key]) => key.replace(/\{(\w+)\}/gu, ':$1') === routeKey(route),
      )!;
      const refs = operation.parameters.map((parameter) => parameter['$ref']);
      const isWrite = route.method !== 'GET';
      const tenantScoped = !isPublicPath(route.path);

      expect({ route: routeKey(route), tenant: refs.includes('#/components/parameters/TenantId') }).toEqual({
        route: routeKey(route),
        tenant: tenantScoped,
      });
      expect({ route: routeKey(route), idem: refs.includes('#/components/parameters/IdempotencyKey') }).toEqual({
        route: routeKey(route),
        idem: tenantScoped && isWrite,
      });
      expect({ route: routeKey(route), bearer: operation.security.length > 0 }).toEqual({
        route: routeKey(route),
        bearer: route.authenticated,
      });
      expect(operation.responses[route.status.toString()]).toBeDefined();
      expect(operation.responses['500']).toEqual({ $ref: '#/components/responses/Error500' });
    }
  });

  it('بدنه‌ی هر مسیر نوشتنی از schema ِ ZodValidationPipe ِ خود سرور می‌آید', () => {
    const withBody = documented.filter((route) => route.inputs.some((input) => input.in === 'body' && input.schema));

    expect(withBody.length).toBeGreaterThanOrEqual(25);
    for (const route of withBody) {
      const [, operation] = operations(document).find(
        ([key]) => key.replace(/\{(\w+)\}/gu, ':$1') === routeKey(route),
      )!;
      expect({ route: routeKey(route), body: operation.requestBody !== undefined }).toEqual({
        route: routeKey(route),
        body: true,
      });
    }
  });

  it('شناسه‌ی هر عملیات یکتاست', () => {
    const ids = operations(document).map(([, operation]) => operation.operationId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('مقدمه قراردادهای سراسری را توضیح می‌دهد', () => {
    const description = (document['info'] as { description: string }).description;

    for (const topic of ['Idempotency-Key', 'BigInt', 'رشته', 'Bearer', 'x-tenant-id', 'ApiError', 'limit', 'offset', 'Snapshot']) {
      expect(description).toContain(topic);
    }
  });

  it('docs/openapi.json مخزن با کد هم‌خوان است (به‌روزرسانی: pnpm --filter @gold/api openapi:generate)', async () => {
    await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot('../../../../../docs/openapi.json');
  });
});
