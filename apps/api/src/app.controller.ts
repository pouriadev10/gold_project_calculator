import { Controller, Get } from '@nestjs/common';

/**
 * پاسخ سلامت — عمداً فقط یک فیلد.
 *
 * نسخه، uptime، وضعیت دیتابیس و timestamp اینجا نمی‌آیند: این endpoint
 * باید بدون هیچ وابستگی‌ای پاسخ بدهد تا load balancer بتواند به آن تکیه کند.
 */
export interface HealthResponse {
  readonly status: 'ok';
}

@Controller()
export class AppController {
  @Get('health')
  health(): HealthResponse {
    return { status: 'ok' };
  }
}
