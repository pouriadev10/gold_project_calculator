import * as contracts from '@gold/contracts';
import { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CONTENT_SHA256_HEADER } from '../exports/tenant-exports.controller';
import { PDF_FILE_NAME_HEADER } from '../files/pdf-response';
import { IDEMPOTENCY_KEY_HEADER } from '../idempotency/idempotency-key';
import { REQUEST_ID_HEADER } from '../request-context/request-id';
import { TENANT_HEADER } from '../request-context/request-context.errors';
import { isPublicPath } from '../request-context/request-path';
import { exampleFor } from './json-examples';
import { OPENAPI_DESCRIPTION } from './openapi-description';
import { ROUTE_DOCS } from './route-docs';
import { routeKey } from './route-discovery';
import type { ZodTypeAny } from 'zod';
import type { JsonSchema, JsonValue } from './json-examples';
import type { DiscoveredInput, DiscoveredRoute } from './route-discovery';
import type { ResponseDoc, RouteDoc } from './route-docs';

export type OpenApiDocument = Record<string, unknown>;

/** نسخه‌ی مستند API فاز ۱. با تغییر ناسازگار قرارداد بالا می‌رود. */
export const API_DOCUMENT_VERSION = '1.0.0';

/** مسیرهایی که هرگز در مستند نمی‌آیند: فقط بیرون از production ثبت می‌شوند و API محصول نیستند. */
export function isDocumentedPath(path: string): boolean {
  return !path.startsWith('/internal/') && !path.startsWith('/docs');
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const TAGS: readonly { name: string; description: string }[] = [
  { name: 'سامانه', description: 'سلامت سرویس' },
  { name: 'احراز هویت', description: 'ورود، تمدید و خروج' },
  { name: 'تنظیمات', description: 'تنظیمات نسخه‌دار مستأجر' },
  { name: 'مظنه', description: 'مظنه‌ی دستی و فید' },
  { name: 'اشخاص', description: 'طرف حساب‌ها، مانده و صورت‌حساب' },
  { name: 'تسویه', description: 'دریافت و پرداخت ریالی، طلایی، سکه‌ای و ترکیبی' },
  { name: 'موجودی', description: 'کالا، سکه و موجودی' },
  { name: 'فروش', description: 'فاکتور فروش زیورآلات و سکه، اصلاح و تاریخچه' },
  { name: 'خرید', description: 'خرید از مصرف‌کننده و مرجوعی مصرف‌کننده (B2C = خرید دست‌دوم)' },
  { name: 'گزارش', description: 'داشبورد، سود، بدهکاران و بستانکاران — با کلید واحد طلا/ریال' },
  { name: 'سکو', description: 'خروجی کامل داده‌ی مستأجر' },
];

const ERROR_RESPONSES: Readonly<Record<string, { code: string; message: string; description: string }>> = {
  '400': { code: 'VALIDATION_ERROR', message: 'ورودی نامعتبر است', description: 'ورودی یا هدر نامعتبر' },
  '401': { code: 'UNAUTHORIZED', message: 'توکن دسترسی ارائه نشده است', description: 'احراز هویت لازم است' },
  '403': { code: 'FORBIDDEN', message: 'اجازه‌ی انجام این عملیات را ندارید', description: 'نقش مجاز نیست یا مستأجر معلق است' },
  '404': { code: 'NOT_FOUND', message: 'داده‌ی مورد نظر پیدا نشد', description: 'در این مستأجر وجود ندارد' },
  '409': { code: 'CONFLICT', message: 'این عملیات با وضعیت فعلی داده‌ها سازگار نیست', description: 'تعارض با قاعده‌ی دامنه یا کلید idempotency' },
  '500': { code: 'INTERNAL_ERROR', message: 'خطای غیرمنتظره‌ای رخ داد', description: 'خطای پیش‌بینی‌نشده' },
};

/** نام component هر schema ِ صادرشده از `@gold/contracts`: `partyListSchema` ← `PartyList`. */
function contractNames(): Map<ZodTypeAny, string> {
  const names = new Map<ZodTypeAny, string>();
  for (const [exportName, value] of Object.entries(contracts)) {
    if (exportName.endsWith('Schema') && value instanceof ZodType && !names.has(value)) {
      const base = exportName.slice(0, -'Schema'.length);
      names.set(value, `${base.charAt(0).toUpperCase()}${base.slice(1)}`);
    }
  }
  return names;
}

/**
 * امضای عمومی `zodToJsonSchema` روی schemaهای بزرگ قرارداد به TS2589 (نوع بی‌انتها)
 * می‌خورد؛ این‌جا فقط ورودی و خروجی ساده لازم است.
 */
const convertZod = zodToJsonSchema as unknown as (
  schema: ZodTypeAny,
  options: { readonly target: 'openApi3'; readonly $refStrategy: 'none' },
) => Record<string, unknown>;

/**
 * `zod-to-json-schema` در هدف openApi3 برای `z.null()` می‌نویسد `{ enum: ["null"], nullable: true }`
 * — یعنی **رشته‌ی** "null". مثلاً `linkedTenantId` فقط `null` می‌پذیرد و مستند نباید رشته پیشنهاد کند.
 */
function normalizeNulls(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeNulls);
  if (typeof node !== 'object' || node === null) return node;

  const record = node as Record<string, unknown>;
  const enumValues = record['enum'];
  if (Array.isArray(enumValues) && enumValues.length === 1 && enumValues[0] === 'null' && record['nullable'] === true) {
    return { ...record, enum: [null] };
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeNulls(value)]));
}

function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  const converted = convertZod(schema, { target: 'openApi3', $refStrategy: 'none' });
  const { $schema: _ignored, ...rest } = converted;
  return normalizeNulls(rest) as JsonSchema;
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/gu, '{$1}');
}

function pathParameterNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/gu)].map((match) => match[1]!);
}

/**
 * نمونه‌ای که schema ِ zod ِ اصلی قبولش دارد. نمونه‌ی خودکار اگر از refine ِ
 * چندفیلدی رد نشود، نمونه‌ی دستی `RouteDoc` جایش را می‌گیرد؛ نبود هر دو خطاست،
 * تا هیچ نمونه‌ای در مستند خلاف قرارداد نباشد.
 */
function validExample(
  schema: ZodTypeAny,
  json: JsonSchema,
  override: unknown,
  where: string,
  failures: string[],
): JsonValue {
  const candidate = override === undefined ? exampleFor(json) : (override as JsonValue);
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    failures.push(`example for ${where} does not satisfy its schema — ${issues}`);
  }
  return candidate;
}

class DocumentBuilder {
  readonly #names = contractNames();
  readonly #components: Record<string, JsonSchema> = {};
  readonly failures: string[] = [];

  /** `$ref` برای schema ِ نام‌دار قرارداد، وگرنه schema ِ درون‌خطی. */
  schemaFor(schema: ZodTypeAny): JsonSchema {
    const name = this.#names.get(schema);
    if (name === undefined) return toJsonSchema(schema);
    this.#components[name] ??= toJsonSchema(schema);
    return { $ref: `#/components/schemas/${name}` };
  }

  components(): Record<string, JsonSchema> {
    return Object.fromEntries(Object.entries(this.#components).sort(([left], [right]) => left.localeCompare(right)));
  }

  parameters(route: DiscoveredRoute): Record<string, unknown>[] {
    const parameters: Record<string, unknown>[] = [];

    for (const name of pathParameterNames(route.path)) {
      const input = route.inputs.find((candidate) => candidate.in === 'path' && candidate.name === name);
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: input?.schema !== undefined ? toJsonSchema(input.schema) : { type: 'string', ...(input?.uuid ? { format: 'uuid' } : {}) },
      });
    }

    for (const input of route.inputs.filter((candidate) => candidate.in === 'query')) {
      parameters.push(...this.queryParameters(input));
    }

    if (!isPublicPath(route.path)) {
      parameters.push({ $ref: '#/components/parameters/TenantId' });
      if (WRITE_METHODS.has(route.method)) {
        parameters.push({ $ref: '#/components/parameters/IdempotencyKey' });
      }
    }
    return parameters;
  }

  private queryParameters(input: DiscoveredInput): Record<string, unknown>[] {
    if (input.schema === undefined) return [];
    const json = toJsonSchema(input.schema);

    if (input.name !== undefined) {
      return [{ name: input.name, in: 'query', required: !input.schema.isOptional(), schema: json }];
    }

    const properties = (json['properties'] ?? {}) as Record<string, JsonSchema>;
    const required = new Set((json['required'] ?? []) as string[]);
    return Object.entries(properties).map(([name, schema]) => ({
      name,
      in: 'query',
      // پارامتر دارای پیش‌فرض در zod «required» است ولی کلاینت لازم نیست بفرستدش.
      required: required.has(name) && !('default' in schema),
      schema,
    }));
  }

  requestBody(route: DiscoveredRoute, doc: RouteDoc): Record<string, unknown> | undefined {
    const body = route.inputs.find((input) => input.in === 'body' && input.schema !== undefined);
    if (body?.schema === undefined) return undefined;

    return {
      required: true,
      content: {
        'application/json': {
          schema: this.schemaFor(body.schema),
          example: validExample(
            body.schema,
            toJsonSchema(body.schema),
            doc.requestExample,
            `${routeKey(route)} body`,
            this.failures,
          ),
        },
      },
    };
  }

  successResponse(route: DiscoveredRoute, response: ResponseDoc, override: unknown): Record<string, unknown> {
    switch (response.kind) {
      case 'empty':
        return { description: 'بدون بدنه' };
      case 'pdf':
        return {
          description: 'فایل PDF. نام فایل در هدر `X-File-Name` (URL-encoded)؛ عمداً بدون `Content-Disposition`.',
          headers: { [PDF_FILE_NAME_HEADER]: { schema: { type: 'string' } } },
          content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
        };
      case 'json-file':
        return {
          description: 'فایل JSON دانلودی',
          headers: {
            [PDF_FILE_NAME_HEADER]: { schema: { type: 'string' } },
            [CONTENT_SHA256_HEADER]: { schema: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
          },
          content: { 'application/json': { schema: this.schemaFor(response.schema) } },
        };
      case 'json': {
        const schema =
          response.wrap === 'array'
            ? response.schema.array()
            : response.wrap === 'nullable'
              ? response.schema.nullable()
              : response.schema;
        const inner = this.schemaFor(response.schema);
        const wrapped =
          response.wrap === 'array'
            ? { type: 'array', items: inner }
            : response.wrap === 'nullable'
              ? { allOf: [inner], nullable: true }
              : inner;
        return {
          description: 'موفق',
          content: {
            'application/json': {
              schema: wrapped,
              example: validExample(schema, toJsonSchema(schema), override, `${routeKey(route)} response`, this.failures),
            },
          },
        };
      }
    }
  }

  operation(route: DiscoveredRoute, doc: RouteDoc): Record<string, unknown> {
    const responses: Record<string, unknown> = {
      [route.status.toString()]: this.successResponse(route, doc.response, doc.responseExample),
    };
    const errorStatuses = ['400'];
    if (route.authenticated) errorStatuses.push('401', '403');
    if (route.authenticated || pathParameterNames(route.path).length > 0) errorStatuses.push('404');
    if (WRITE_METHODS.has(route.method)) errorStatuses.push('409');
    errorStatuses.push('500');
    for (const status of errorStatuses) {
      responses[status] = { $ref: `#/components/responses/Error${status}` };
    }

    const rolesLine = !route.authenticated
      ? 'بدون احراز هویت.'
      : route.roles.length > 0
        ? `نقش‌های مجاز: ${route.roles.map((role) => `\`${role}\``).join('، ')}.`
        : 'همه‌ی نقش‌های عضو مستأجر.';
    const requestBody = this.requestBody(route, doc);

    return {
      tags: [doc.tag],
      summary: doc.summary,
      description: [doc.description, rolesLine].filter((line) => line !== undefined).join('\n\n'),
      operationId: `${route.controller}_${route.handler}`,
      ...(route.authenticated ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      ...(route.roles.length > 0 ? { 'x-roles': [...route.roles] } : {}),
      parameters: this.parameters(route),
      ...(requestBody === undefined ? {} : { requestBody }),
      responses,
    };
  }
}

function errorResponses(builder: DocumentBuilder): Record<string, unknown> {
  const errorSchema = builder.schemaFor(contracts.apiErrorSchema);
  return Object.fromEntries(
    Object.entries(ERROR_RESPONSES).map(([status, error]) => [
      `Error${status}`,
      {
        description: error.description,
        headers: { [REQUEST_ID_HEADER]: { schema: { type: 'string', format: 'uuid' } } },
        content: {
          'application/json': {
            schema: errorSchema,
            example: {
              error: {
                code: error.code,
                message: error.message,
                fields: status === '400' ? { partyId: ['شناسه باید UUID معتبر باشد'] } : {},
                requestId: '6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8',
              },
            },
          },
        },
      },
    ]),
  );
}

/**
 * مستند OpenAPI ِ مسیرهای فاز ۱ — BE-070.
 *
 * ورودی‌ها از metadata ِ Nest می‌آیند و پاسخ‌ها از `ROUTE_DOCS`، و هر دو به
 * schemaهای zod ِ `@gold/contracts` اشاره می‌کنند — همان schemaهایی که سرور
 * ورودی را با آن‌ها رد می‌کند و کلاینت پاسخ را با آن‌ها می‌خواند. مسیری بدون
 * مستند یا مستندی بدون مسیر خطاست.
 */
export function buildOpenApiDocument(routes: readonly DiscoveredRoute[]): OpenApiDocument {
  const builder = new DocumentBuilder();
  const documented = routes.filter((route) => isDocumentedPath(route.path));
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of documented) {
    const doc = ROUTE_DOCS[routeKey(route)];
    if (doc === undefined) {
      throw new Error(`route ${routeKey(route)} has no entry in ROUTE_DOCS`);
    }
    const pathItem = (paths[openApiPath(route.path)] ??= {});
    pathItem[route.method.toLowerCase()] = builder.operation(route, doc);
  }

  const known = new Set(documented.map(routeKey));
  const stale = Object.keys(ROUTE_DOCS).filter((key) => !known.has(key));
  if (stale.length > 0) {
    throw new Error(`ROUTE_DOCS documents routes the server does not have: ${stale.join(', ')}`);
  }

  if (builder.failures.length > 0) {
    throw new Error(`OpenAPI examples are invalid:\n${builder.failures.join('\n')}`);
  }

  const responses = errorResponses(builder);

  return {
    openapi: '3.0.3',
    info: {
      title: 'Gold Accounting API — فاز ۱',
      version: API_DOCUMENT_VERSION,
      description: OPENAPI_DESCRIPTION,
    },
    servers: [
      { url: '/', description: 'مستقیم روی API' },
      { url: '/api', description: 'پشت پراکسی فرانت (Vite یا nginx)' },
    ],
    tags: TAGS,
    paths: Object.fromEntries(Object.entries(paths).sort(([left], [right]) => left.localeCompare(right))),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'accessToken از `POST /auth/login`' },
      },
      parameters: {
        TenantId: {
          name: TENANT_HEADER,
          in: 'header',
          required: true,
          description: 'شناسه‌ی مستأجر جاری (`tenant.id` پاسخ ورود).',
          schema: { type: 'string', format: 'uuid' },
        },
        IdempotencyKey: {
          name: IDEMPOTENCY_KEY_HEADER,
          in: 'header',
          required: true,
          description: 'برای هر عمل کاربر یک کلید تازه (UUID پیشنهاد می‌شود)؛ در تلاش مجدد همان کلید و همان بدنه.',
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      },
      responses,
      schemas: builder.components(),
    },
  };
}
