import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_DATABASE_ROLE, TENANT_SETTING } from '../src/platform/database/tenant-transaction';
import type { PoolClient } from 'pg';

interface TenantFixture {
  id: string;
  slug: string;
}

/** Party data model with direct PostgreSQL checks for RLS and search indexes. */
describe('party model (requires real PostgreSQL)', () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });
  const tenantA: TenantFixture = { id: '', slug: `parties-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `parties-b-${randomUUID().slice(0, 12)}` };
  let partyA = '';
  let partyB = '';

  async function asTenant<T>(
    tenantId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
      await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
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
    for (const tenant of [tenantA, tenantB]) {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id',
        [`مستأجر ${tenant.slug}`, tenant.slug],
      );
      tenant.id = rows[0]!.id;
    }

    const insert = async (tenant: TenantFixture, name: string, mobile: string): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO parties
          (tenant_id, type, display_name, normalized_name, mobile, normalized_mobile, linked_tenant_id)
         VALUES ($1, 'CONSUMER', $2, $2, $3, $3, $4)
         RETURNING id`,
        [tenant.id, name, mobile, tenantB.id],
      );
      return rows[0]!.id;
    };

    partyA = await insert(tenantA, 'مشتری الف', '09120000001');
    partyB = await insert(tenantB, 'مشتری ب', '09120000002');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA.id, tenantB.id]]);
    await pool.end();
  });

  it('creates tenant-scoped search indexes and enables RLS on parties', async () => {
    const { rows: indexes } = await pool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'parties'
         AND indexname = ANY($1)`,
      [['parties_tenant_normalized_name_idx', 'parties_tenant_normalized_mobile_idx']],
    );
    const { rows: tables } = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.parties'::regclass`,
    );

    expect(indexes.map((index) => index.indexname).sort()).toEqual([
      'parties_tenant_normalized_mobile_idx',
      'parties_tenant_normalized_name_idx',
    ]);
    expect(tables[0]?.relrowsecurity).toBe(true);
  });

  it('isolates party rows and rejects cross-tenant writes in PostgreSQL', async () => {
    const visible = await asTenant(tenantA.id, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM parties');
      return result.rows.map((row) => row.id);
    });

    expect(visible).toEqual([partyA]);
    await expect(
      asTenant(tenantA.id, async (client) => {
        await client.query(
          `INSERT INTO parties (tenant_id, type, display_name, normalized_name)
           VALUES ($1, 'BUSINESS', 'جعل', 'جعل')`,
          [tenantB.id],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('uses status for deactivation while retaining the party record', async () => {
    const affected = await asTenant(tenantA.id, async (client) => {
      const result = await client.query(
        `UPDATE parties
         SET status = 'INACTIVE'
         WHERE id = $1`,
        [partyA],
      );
      return result.rowCount;
    });
    const { rows } = await pool.query<{ status: 'ACTIVE' | 'INACTIVE'; linkedTenantId: string | null }>(
      `SELECT status, linked_tenant_id AS "linkedTenantId"
       FROM parties
       WHERE id = $1`,
      [partyA],
    );

    expect(affected).toBe(1);
    expect(rows).toEqual([{ status: 'INACTIVE', linkedTenantId: tenantB.id }]);
    expect(partyB).not.toBe('');
  });
});
