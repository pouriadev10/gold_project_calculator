import { describe, expect, it } from 'vitest';
import { uuidSchema } from '../src/index.js';

describe('uuidSchema', () => {
  it('UUID معتبر را می‌پذیرد', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    expect(uuidSchema.parse(id)).toBe(id);
  });

  it.each([
    ['3f2504e0-4f89-41d3-9a0c', 'ناقص'],
    ['3f2504e04f8941d39a0c0305e82c3301', 'بدون خط تیره'],
    ['zzzzzzzz-4f89-41d3-9a0c-0305e82c3301', 'حرف خارج از مبنای شانزده'],
    ['', 'خالی'],
    ['42', 'عدد'],
  ])('مقدار نامعتبر %s را رد می‌کند (%s)', (value) => {
    expect(uuidSchema.safeParse(value).success).toBe(false);
  });
});
