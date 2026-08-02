import { describe, expect, it } from 'vitest';
import { AppController } from './app.controller';

describe('AppController', () => {
  it('متد health دقیقاً { status: "ok" } برمی‌گرداند', () => {
    const controller = new AppController();

    expect(controller.health()).toEqual({ status: 'ok' });
  });
});
