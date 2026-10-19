import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { shouldRegisterDevEndpoints } from '../config/dev-endpoints';
import { OpenApiController } from './openapi.controller';

/*
 * Swagger UI در production ثبت نمی‌شود: نقشه‌ی کامل API برای مهاجم رایگان است و
 * کاربر نهایی آن را لازم ندارد. مستند ثابت در `docs/openapi.json` مخزن می‌ماند.
 */
const CONTROLLERS: Type[] = shouldRegisterDevEndpoints() ? [OpenApiController] : [];

/** مستند API — BE-070. */
@Module({ controllers: CONTROLLERS })
export class OpenApiModule {}
