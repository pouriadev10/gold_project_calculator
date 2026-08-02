import { Module } from '@nestjs/common';

/**
 * context هر درخواست (tenant و user جاری) با AsyncLocalStorage — BE-008.
 *
 * اسکلت خالی.
 */
@Module({})
export class RequestContextModule {}
