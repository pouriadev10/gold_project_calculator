import { Module } from '@nestjs/common';
import { DocumentCountersService } from './document-counters.service';

/**
 * فروش، فاکتور و اصلاح فاکتور — BE-038 تا BE-043 و BE-053 تا BE-055.
 *
 * مرجوعی B2C اینجا نیست؛ طبق بخش ۲-۵ قواعد پروژه یک خرید است و در
 * `purchase` پیاده می‌شود.
 */
@Module({
  providers: [DocumentCountersService],
  exports: [DocumentCountersService],
})
export class SalesModule {}
