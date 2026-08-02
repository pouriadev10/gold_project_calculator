import { Module } from '@nestjs/common';
import { AppController } from './app.controller';

/**
 * ماژول ریشه. ماژول‌های دامنه (ledger, pricing, inventory, …) در تسک‌های
 * بعدی زیر `src/modules/` اضافه می‌شوند — بخش ۴ فایل CLAUDE.md.
 */
@Module({
  controllers: [AppController],
})
export class AppModule {}
