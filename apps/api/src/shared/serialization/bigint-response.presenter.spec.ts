import { describe, expect, it } from 'vitest';
import {
  BigIntResponseSerializationError,
  presentBigIntResponse,
} from './bigint-response.presenter';

describe('presentBigIntResponse', () => {
  it('همه‌ی bigintهای تو در تو را پیش از JSON.stringify به رشته تبدیل می‌کند', () => {
    const response = presentBigIntResponse({
      amountRial: 12500000n,
      rows: [{ weightMg: 1250n }],
    });

    expect(response).toEqual({
      amountRial: '12500000',
      rows: [{ weightMg: '1250' }],
    });
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it('DTO حلقوی را با خطای روشن رد می‌کند', () => {
    const response: { self?: unknown } = {};
    response.self = response;

    expect(() => presentBigIntResponse(response)).toThrow(BigIntResponseSerializationError);
  });
});
