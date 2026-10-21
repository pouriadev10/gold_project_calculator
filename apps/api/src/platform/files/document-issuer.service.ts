import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { tenants } from '../database/schema';
import type { Database } from '../database/connect';
import type { DocumentIssuer } from './invoice-exporter';

/** Resolves the tenant identity printed as the issuer of a generated document. */
@Injectable()
export class DocumentIssuerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getIssuer(tenantId: string): Promise<DocumentIssuer> {
    const [tenant] = await this.db
      .select({ name: tenants.name, timeZone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (tenant === undefined) {
      throw new Error('Tenant required for document export was not found');
    }

    return { displayName: tenant.name, mobile: null, timeZone: tenant.timeZone };
  }
}
