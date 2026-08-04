import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { tenants, versionedSettings } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { VersionedSettingsService } from '../src/modules/pricing/versioned-settings.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

const SETTING_KEY = 'pricing.base_quote_karat';
const FIRST_EFFECTIVE_AT = new Date('2026-01-01T00:00:00.000Z');
const SECOND_EFFECTIVE_AT = new Date('2026-02-01T00:00:00.000Z');

describe('تنظیمات نسخه‌دار (نیازمند PostgreSQL واقعی)', () => {
  const tenant = { id: '', slug: `settings-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let settings: VersionedSettingsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    settings = app.get(VersionedSettingsService);

    const [created] = await db
      .insert(tenants)
      .values({ name: 'مستأجر آزمون تنظیمات', slug: tenant.slug })
      .returning();
    tenant.id = created!.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('نسخه‌ی جدید بازه‌ی نسخه‌ی قبلی را می‌بندد، بدون تغییر مقدار قبلی', async () => {
    const first = await settings.createVersion({
      tenantId: tenant.id,
      settingKey: SETTING_KEY,
      valueJson: { karat: '705' },
      validFrom: FIRST_EFFECTIVE_AT,
    });
    const second = await settings.createVersion({
      tenantId: tenant.id,
      settingKey: SETTING_KEY,
      valueJson: { karat: '750' },
      validFrom: SECOND_EFFECTIVE_AT,
    });
    const [storedFirst] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(versionedSettings)
        .where(eq(versionedSettings.id, first.id)),
    );

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(storedFirst).toMatchObject({ valueJson: { karat: '705' }, validTo: SECOND_EFFECTIVE_AT });
    expect(second.validTo).toBeNull();
  });

  it('query تاریخی دقیقاً نسخه‌ی مؤثر همان تاریخ را می‌دهد', async () => {
    const inJanuary = await settings.getEffective(
      tenant.id,
      SETTING_KEY,
      new Date('2026-01-15T00:00:00.000Z'),
    );
    const inFebruary = await settings.getEffective(
      tenant.id,
      SETTING_KEY,
      new Date('2026-02-15T00:00:00.000Z'),
    );

    expect(inJanuary).toMatchObject({ version: 1, valueJson: { karat: '705' } });
    expect(inFebruary).toMatchObject({ version: 2, valueJson: { karat: '750' } });
  });

  it('constraint دیتابیس هر بازه‌ی هم‌پوشان را حتی بیرون از service رد می‌کند', async () => {
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.insert(versionedSettings).values({
          tenantId: tenant.id,
          settingKey: SETTING_KEY,
          valueJson: { karat: '999' },
          validFrom: new Date('2026-01-15T00:00:00.000Z'),
          version: 99,
          createdBy: null,
        }),
      ),
    ).rejects.toThrow();
  });
});
