import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_DATABASE_ROLE, TENANT_SETTING } from '../src/platform/database/tenant-transaction';
import type { PoolClient } from 'pg';

/**
 * جداسازی مستأجر در سطح PostgreSQL — BE-009.
 *
 * عمداً با `pg` خام نوشته شده و نه از مسیر Nest یا drizzle: قاعده‌ی این
 * تسک می‌گوید «اتکا به `WHERE tenant_id = ...` به‌تنهایی کافی نیست» و
 * «RLS باید در PostgreSQL enforce شود». اگر تست از لایه‌ی برنامه عبور
 * می‌کرد، چیزی که واقعاً می‌سنجید فیلترهای همان لایه بود، نه سیاست
 * دیتابیس. اینجا کوئری‌ها بدون هیچ شرط `tenant_id` نوشته می‌شوند —
 * هر ردیفی که فیلتر شود، کار PostgreSQL است.
 */
describe('Row-Level Security (نیازمند PostgreSQL واقعی)', () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });

  const tenantA = { id: '', slug: `rls-a-${randomUUID().slice(0, 8)}` };
  const tenantB = { id: '', slug: `rls-b-${randomUUID().slice(0, 8)}` };
  let probeA = '';
  let probeB = '';

  /** کوئری با نقش محدود و مستأجر مشخص — همان کاری که `withTenantTransaction` می‌کند. */
  async function asTenant<T>(
    tenantId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);

      if (tenantId !== null) {
        await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
      }

      const result = await work(client);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    // ساخت داده با کاربر مهاجرت (سوپرکاربر) — یعنی خارج از دید RLS.
    for (const tenant of [tenantA, tenantB]) {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id',
        [`مستأجر ${tenant.slug}`, tenant.slug],
      );
      tenant.id = rows[0]!.id;
    }

    const insertProbe = async (tenantId: string, note: string): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO rls_probes (tenant_id, note) VALUES ($1, $2) RETURNING id',
        [tenantId, note],
      );
      return rows[0]!.id;
    };

    probeA = await insertProbe(tenantA.id, 'راز مستأجر الف');
    probeB = await insertProbe(tenantB.id, 'راز مستأجر ب');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA.id, tenantB.id]]);
    await pool.end();
  });

  describe('نقش برنامه واقعاً محدود است', () => {
    it('gold_app نه سوپرکاربر است نه BYPASSRLS — وگرنه کل این تست بی‌معنا بود', async () => {
      const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [APP_DATABASE_ROLE],
      );

      expect(rows[0]?.rolsuper).toBe(false);
      expect(rows[0]?.rolbypassrls).toBe(false);
    });

    it('کاربر مهاجرت RLS را دور می‌زند — دلیل وجود نقش جداگانه', async () => {
      // بدون SET LOCAL ROLE، همان کوئریِ بدون شرط هر دو ردیف را می‌بیند.
      const { rows } = await pool.query('SELECT id FROM rls_probes WHERE id = ANY($1)', [
        [probeA, probeB],
      ]);

      expect(rows).toHaveLength(2);
    });
  });

  describe('خواندن', () => {
    it('مستأجر الف فقط ردیف خودش را می‌بیند', async () => {
      const rows = await asTenant(tenantA.id, async (client) => {
        // هیچ شرط tenant_id در کوئری نیست — فیلتر کار PostgreSQL است.
        const result = await client.query<{ id: string }>('SELECT id FROM rls_probes');
        return result.rows;
      });

      expect(rows.map((row) => row.id)).toEqual([probeA]);
    });

    it('مستأجر الف حتی با شناسه‌ی صریح ردیف ب را نمی‌بیند', async () => {
      const rows = await asTenant(tenantA.id, async (client) => {
        const result = await client.query('SELECT id FROM rls_probes WHERE id = $1', [probeB]);
        return result.rows;
      });

      expect(rows).toHaveLength(0);
    });

    it('بدون مستأجر تنظیم‌شده هیچ ردیفی دیده نمی‌شود — خرابی در جهت بسته', async () => {
      const rows = await asTenant(null, async (client) => {
        const result = await client.query('SELECT id FROM rls_probes');
        return result.rows;
      });

      expect(rows).toHaveLength(0);
    });
  });

  describe('نوشتن', () => {
    it('مستأجر الف نمی‌تواند ردیف ب را update کند', async () => {
      const affected = await asTenant(tenantA.id, async (client) => {
        const result = await client.query('UPDATE rls_probes SET note = $1 WHERE id = $2', [
          'دستکاری‌شده',
          probeB,
        ]);
        return result.rowCount;
      });

      expect(affected).toBe(0);

      // و ردیف ب واقعاً دست‌نخورده مانده است.
      const { rows } = await pool.query<{ note: string }>(
        'SELECT note FROM rls_probes WHERE id = $1',
        [probeB],
      );
      expect(rows[0]?.note).toBe('راز مستأجر ب');
    });

    it('مستأجر الف نمی‌تواند ردیف ب را delete کند', async () => {
      const affected = await asTenant(tenantA.id, async (client) => {
        const result = await client.query('DELETE FROM rls_probes WHERE id = $1', [probeB]);
        return result.rowCount;
      });

      expect(affected).toBe(0);

      const { rows } = await pool.query('SELECT id FROM rls_probes WHERE id = $1', [probeB]);
      expect(rows).toHaveLength(1);
    });

    it('مستأجر الف نمی‌تواند ردیفی به نام مستأجر ب درج کند', async () => {
      await expect(
        asTenant(tenantA.id, async (client) => {
          await client.query('INSERT INTO rls_probes (tenant_id, note) VALUES ($1, $2)', [
            tenantB.id,
            'جعل هویت',
          ]);
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it('مستأجر الف روی ردیف خودش کاملاً آزاد است', async () => {
      const affected = await asTenant(tenantA.id, async (client) => {
        const result = await client.query('UPDATE rls_probes SET note = $1 WHERE id = $2', [
          'به‌روزشده توسط خودش',
          probeA,
        ]);
        return result.rowCount;
      });

      expect(affected).toBe(1);
    });
  });

  describe('نشت نکردن بین تراکنش‌ها', () => {
    it('مستأجر تراکنش قبلی به تراکنش بعدیِ همان pool نشت نمی‌کند', async () => {
      await asTenant(tenantA.id, async (client) => {
        await client.query('SELECT id FROM rls_probes');
      });

      // همان اتصال pool، این بار بدون تنظیم مستأجر.
      const rows = await asTenant(null, async (client) => {
        const result = await client.query('SELECT id FROM rls_probes');
        return result.rows;
      });

      expect(rows).toHaveLength(0);
    });

    it('نقش هم پس از پایان تراکنش برمی‌گردد', async () => {
      await asTenant(tenantA.id, async (client) => {
        const result = await client.query<{ current_user: string }>('SELECT current_user');
        expect(result.rows[0]?.current_user).toBe(APP_DATABASE_ROLE);
      });

      const { rows } = await pool.query<{ current_user: string }>('SELECT current_user');
      expect(rows[0]?.current_user).not.toBe(APP_DATABASE_ROLE);
    });
  });
});
