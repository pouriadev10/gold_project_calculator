import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Type } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AuditModule } from '../src/platform/audit/audit.module';
import { AuthModule } from '../src/platform/auth/auth.module';
import { ConfigModule } from '../src/platform/config/config.module';
import { DatabaseModule } from '../src/platform/database/database.module';
import { IdempotencyModule } from '../src/platform/idempotency/idempotency.module';
import { RequestContextModule } from '../src/platform/request-context/request-context.module';
import { TenantModule } from '../src/platform/tenant/tenant.module';
import { UsersModule } from '../src/platform/users/users.module';
import { InventoryModule } from '../src/modules/inventory/inventory.module';
import { LedgerModule } from '../src/modules/ledger/ledger.module';
import { PartiesModule } from '../src/modules/parties/parties.module';
import { PricingModule } from '../src/modules/pricing/pricing.module';
import { PurchaseModule } from '../src/modules/purchase/purchase.module';
import { ReportingModule } from '../src/modules/reporting/reporting.module';
import { SalesModule } from '../src/modules/sales/sales.module';
import { SettlementModule } from '../src/modules/settlement/settlement.module';
import { TaxModule } from '../src/modules/tax/tax.module';
import { TenantInitializationModule } from '../src/tenant-initialization.module';

/**
 * فهرست صریح است و نه مشتق‌شده از متادیتای `AppModule` — عمداً.
 * اگر ماژولی ساخته شود ولی به `AppModule` وصل نشود، تست باید بشکند؛
 * فهرستی که خودش از `AppModule` خوانده شود هرگز این را نمی‌گیرد.
 */
const PLATFORM_MODULES: ReadonlyArray<readonly [string, Type]> = [
  ['ConfigModule', ConfigModule],
  ['DatabaseModule', DatabaseModule],
  ['RequestContextModule', RequestContextModule],
  ['TenantModule', TenantModule],
  ['UsersModule', UsersModule],
  ['AuthModule', AuthModule],
  ['IdempotencyModule', IdempotencyModule],
  ['AuditModule', AuditModule],
];

const DOMAIN_MODULES: ReadonlyArray<readonly [string, Type]> = [
  ['PricingModule', PricingModule],
  ['PartiesModule', PartiesModule],
  ['InventoryModule', InventoryModule],
  ['LedgerModule', LedgerModule],
  ['SalesModule', SalesModule],
  ['PurchaseModule', PurchaseModule],
  ['SettlementModule', SettlementModule],
  ['ReportingModule', ReportingModule],
  ['TaxModule', TaxModule],
];

const COMPOSITION_MODULES: ReadonlyArray<readonly [string, Type]> = [
  ['TenantInitializationModule', TenantInitializationModule],
];

describe('ساختار مونولیت ماژولار', () => {
  let app: NestFastifyApplication;
  const adapter = new FastifyAdapter();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(PLATFORM_MODULES)('ماژول زیرساخت %s توسط Nest resolve می‌شود', (_name, moduleClass) => {
    expect(app.get(moduleClass)).toBeInstanceOf(moduleClass);
  });

  it.each(DOMAIN_MODULES)('ماژول دامنه %s توسط Nest resolve می‌شود', (_name, moduleClass) => {
    expect(app.get(moduleClass)).toBeInstanceOf(moduleClass);
  });

  it.each(COMPOSITION_MODULES)(
    'ماژول اتصال‌دهنده %s توسط Nest resolve می‌شود',
    (_name, moduleClass) => {
      expect(app.get(moduleClass)).toBeInstanceOf(moduleClass);
    },
  );

  it('ماژول tax عمداً خالی است — نه controller، نه provider', () => {
    expect(Reflect.getMetadata('controllers', TaxModule)).toBeUndefined();
    expect(Reflect.getMetadata('providers', TaxModule)).toBeUndefined();
  });

  it('ماژول tax هیچ routeی ثبت نمی‌کند', () => {
    const routes = adapter.getInstance().printRoutes({ commonPrefix: false });

    expect(routes).toContain('health');
    expect(routes).not.toMatch(/tax/i);
  });
});
