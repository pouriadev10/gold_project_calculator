/**
 * نمونه‌ی JSON از روی JSON Schema — BE-070.
 *
 * نمونه‌ها دستی نوشته نمی‌شوند تا با قرارداد واگرا نشوند: از همان schema ساخته
 * می‌شوند و `openapi-document.ts` هر نمونه را دوباره با schema ِ zod ِ اصلی
 * اعتبارسنجی می‌کند. پول و وزن در قرارداد رشته‌ی عدد صحیح‌اند، پس نمونه‌شان هم
 * رشته است — نه به انتخاب این فایل، به حکم schema.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const EXAMPLE_UUID = '3f9b2c1e-7a4d-4e8b-9c2f-5d6a7b8c9d0e';
const EXAMPLE_DATE_TIME = '2026-03-21T07:00:00.000Z';

/** نامزدهای رشته‌ی دارای pattern، به ترتیب ترجیح. اولین که بخورد برنده است. */
const PATTERN_CANDIDATES = [
  '125000000',
  '1',
  '-125000000',
  'a'.repeat(64),
  'BAHAR_AZADI_NEW',
  'VALIDATION_ERROR',
  'S-1405-00001',
  'Asia/Tehran',
];

/** مقدار نمونه‌ی خوش‌معناتر برای بعضی کلیدها، اگر با schema جور باشد. */
function keyHint(key: string | undefined): readonly JsonValue[] {
  if (key === undefined) return [];
  if (/karat/iu.test(key)) return [750];
  if (/mg$/iu.test(key) || /weight/iu.test(key)) return ['8133'];
  if (/ug$/iu.test(key)) return ['8133000'];
  if (/rial$/iu.test(key) || /amount/iu.test(key) || /price/iu.test(key)) return ['125000000'];
  if (/count/iu.test(key) || /quantity/iu.test(key)) return ['2'];
  if (/email/iu.test(key)) return ['owner@example.com'];
  if (/slug/iu.test(key)) return ['tala-shop'];
  if (/timezone/iu.test(key)) return ['Asia/Tehran'];
  if (/displayName|title|name/u.test(key)) return ['علی رضایی'];
  return [];
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(schema: JsonSchema): string | undefined {
  const type = schema['type'];
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.find((item): item is string => typeof item === 'string' && item !== 'null');
  return undefined;
}

function numberAt(schema: JsonSchema, key: string): number | undefined {
  const value = schema[key];
  return typeof value === 'number' ? value : undefined;
}

function fitsString(schema: JsonSchema, value: JsonValue): value is string {
  if (typeof value !== 'string') return false;
  const pattern = schema['pattern'];
  const minLength = numberAt(schema, 'minLength') ?? 0;
  const maxLength = numberAt(schema, 'maxLength') ?? Number.POSITIVE_INFINITY;
  return (
    value.length >= minLength &&
    value.length <= maxLength &&
    (typeof pattern !== 'string' || new RegExp(pattern, 'u').test(value))
  );
}

function stringExample(schema: JsonSchema, key: string | undefined): string {
  const format = schema['format'];
  if (format === 'uuid') return EXAMPLE_UUID;
  if (format === 'date-time') return EXAMPLE_DATE_TIME;
  if (format === 'email') return 'owner@example.com';

  for (const candidate of [...keyHint(key), ...PATTERN_CANDIDATES, 'نمونه']) {
    if (fitsString(schema, candidate)) return candidate;
  }
  const minLength = numberAt(schema, 'minLength') ?? 1;
  return 'x'.repeat(Math.max(minLength, 1));
}

function numberExample(schema: JsonSchema, key: string | undefined): number {
  const minimum = numberAt(schema, 'minimum') ?? (numberAt(schema, 'exclusiveMinimum') ?? 0) + 1;
  const maximum = numberAt(schema, 'maximum') ?? Number.POSITIVE_INFINITY;
  const hinted = keyHint(key).find((value): value is number => typeof value === 'number');

  if (hinted !== undefined && hinted >= minimum && hinted <= maximum) return hinted;
  return Math.min(Math.max(minimum, 1), maximum);
}

function variants(schema: JsonSchema): readonly JsonSchema[] | undefined {
  for (const key of ['anyOf', 'oneOf']) {
    const options = schema[key];
    if (Array.isArray(options)) {
      return options.filter(isRecord).filter((option) => option['type'] !== 'null');
    }
  }
  return undefined;
}

/** یک مقدار نمونه برای schema؛ `key` نام فیلد والد است، برای انتخاب نمونه‌ی خوش‌معناتر. */
export function exampleFor(schema: JsonSchema, key?: string): JsonValue {
  if ('const' in schema) return schema['const'] as JsonValue;
  if (Array.isArray(schema['enum'])) return schema['enum'][0] as JsonValue;
  if ('default' in schema && schema['default'] !== undefined) return schema['default'] as JsonValue;

  const options = variants(schema);
  if (options !== undefined && options[0] !== undefined) return exampleFor(options[0], key);

  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    /*
     * schemaها ادغام می‌شوند، نه نمونه‌ها: `z.pipe()` دو schema ِ رشته‌ای می‌دهد و ادغام
     * نمونه‌ها رشته را به شیء حرف‌به‌حرف تبدیل می‌کرد. خاصیت‌های شیء هم کنار هم می‌نشینند.
     */
    const parts = allOf.filter(isRecord);
    const properties = Object.assign({}, ...parts.map((part) => (isRecord(part['properties']) ? part['properties'] : {})));
    const merged: JsonSchema = Object.assign({}, ...parts, Object.keys(properties).length > 0 ? { properties } : {});
    return exampleFor(merged, key);
  }

  switch (typeOf(schema)) {
    case 'string':
      return stringExample(schema, key);
    case 'integer':
    case 'number':
      return numberExample(schema, key);
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array': {
      const items = schema['items'];
      const count = Math.max(numberAt(schema, 'minItems') ?? 1, 1);
      return isRecord(items) ? Array.from({ length: count }, () => exampleFor(items, key)) : [];
    }
    case 'object':
    default: {
      const properties = schema['properties'];
      const result: Record<string, JsonValue> = {};
      if (isRecord(properties)) {
        for (const [name, property] of Object.entries(properties)) {
          if (isRecord(property)) result[name] = exampleFor(property, name);
        }
      }
      const additional = schema['additionalProperties'];
      if (Object.keys(result).length === 0 && isRecord(additional)) {
        result['key'] = exampleFor(additional, key);
      }
      return result;
    }
  }
}
