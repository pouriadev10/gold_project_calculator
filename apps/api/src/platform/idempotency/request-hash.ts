import { createHash } from 'node:crypto';
import { InvalidIdempotencyRequestError } from './idempotency.errors';

/** بخش‌های مؤثر در هویت یک درخواست نوشتنی. */
export interface IdempotencyRequest {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
}

function isRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * JSON پایدار بدون وابستگی خارجی. ترتیب کلیدهای object را یکسان می‌کند تا
 * `{a: 1, b: 2}` و `{b: 2, a: 1}` یک درخواست به‌شمار آیند.
 */
function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new InvalidIdempotencyRequestError();
      }
      return JSON.stringify(value);
    case 'undefined':
      return 'undefined';
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new InvalidIdempotencyRequestError();
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(',')}]`;
      }

      if (!isRecord(value)) {
        throw new InvalidIdempotencyRequestError();
      }

      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
        .join(',')}}`;
    default:
      throw new InvalidIdempotencyRequestError();
  }
}

/**
 * hash شامل متد و مسیر است، نه فقط body؛ استفاده‌ی ناخواسته از یک key برای
 * دو endpoint متفاوت هم conflict خواهد شد.
 */
export function hashIdempotencyRequest(request: IdempotencyRequest): string {
  const normalized = {
    body: request.body,
    method: request.method.toUpperCase(),
    path: request.path,
  };

  return createHash('sha256').update(canonicalize(normalized), 'utf8').digest('hex');
}
