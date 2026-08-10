import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { normalizeTextForSearch, normalizeTextForStorage } from '../../shared/validation';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { parties } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import type { Database } from '../../platform/database/connect';
import type { Party } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { CreatePartyInput, PartyListQuery, UpdatePartyInput } from '@gold/contracts';

const MOBILE_SEPARATOR = /[\s\-()[\]{}./\\]/gu;

export interface PartyAuditMetadata {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreatePartyCommand extends PartyAuditMetadata {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly input: CreatePartyInput;
}

export interface UpdatePartyCommand extends PartyAuditMetadata {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly partyId: string;
  readonly input: UpdatePartyInput;
}

export interface DeactivatePartyCommand extends PartyAuditMetadata {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly partyId: string;
}

export interface PartyPage {
  readonly items: readonly Party[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export class PartyNotFoundError extends Error {
  constructor() {
    super('شخص مورد نظر پیدا نشد');
  }
}

function normalizeMobile(value: string): string {
  return normalizeTextForSearch(value).replace(MOBILE_SEPARATOR, '');
}

function partyAuditData(party: Party) {
  return {
    type: party.type,
    displayName: party.displayName,
    status: party.status,
    hasMobile: party.mobile !== null,
    hasNationalId: party.nationalId !== null,
    linkedTenantId: party.linkedTenantId,
    hasNotes: party.notes !== null,
  };
}

/**
 * Tenant-scoped counterparty lifecycle. Party records are kept for accounting
 * history; `findActive` is the mandatory lookup for new transactions.
 */
@Injectable()
export class PartiesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    command: CreatePartyCommand,
  ): Promise<Party> {
    const displayName = normalizeTextForStorage(command.input.displayName);
    const mobile =
      command.input.mobile === undefined ? null : normalizeTextForStorage(command.input.mobile);
    const [created] = await transaction
      .insert(parties)
      .values({
        tenantId: command.tenantId,
        type: command.input.type,
        displayName,
        normalizedName: normalizeTextForSearch(displayName),
        mobile,
        normalizedMobile: mobile === null ? null : normalizeMobile(mobile),
        nationalId:
          command.input.nationalId === undefined
            ? null
            : normalizeTextForStorage(command.input.nationalId),
        linkedTenantId: command.input.linkedTenantId ?? null,
        notes:
          command.input.notes === undefined ? null : normalizeTextForStorage(command.input.notes),
      })
      .returning();
    const party = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: command.tenantId,
      actorUserId: command.actorUserId,
      action: 'PARTY_CREATED',
      entityType: 'party',
      entityId: party.id,
      afterData: partyAuditData(party),
      ipAddress: command.ipAddress ?? null,
      userAgent: command.userAgent ?? null,
    });

    return party;
  }

  async list(tenantId: string, query: PartyListQuery): Promise<PartyPage> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const conditions = [eq(parties.tenantId, tenantId)];
      if (query.type !== undefined) {
        conditions.push(eq(parties.type, query.type));
      }
      if (query.status !== undefined) {
        conditions.push(eq(parties.status, query.status));
      }
      if (query.search !== undefined) {
        const search = normalizeTextForSearch(query.search);
        const mobileSearch = normalizeMobile(query.search);
        conditions.push(
          or(
            ilike(parties.normalizedName, `%${search}%`),
            ilike(parties.normalizedMobile, `%${mobileSearch}%`),
          )!,
        );
      }
      const where = and(...conditions);
      const [items, counted] = await Promise.all([
        transaction
          .select()
          .from(parties)
          .where(where)
          .orderBy(asc(parties.normalizedName), asc(parties.id))
          .limit(query.limit)
          .offset(query.offset),
        transaction.select({ total: count() }).from(parties).where(where),
      ]);

      return { items, total: counted[0]!.total, limit: query.limit, offset: query.offset };
    });
  }

  async findById(tenantId: string, partyId: string): Promise<Party | undefined> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.findByIdInTransaction(transaction, tenantId, partyId),
    );
  }

  /** Lookup for source documents: inactive parties must never be selectable for a new transaction. */
  async findActive(tenantId: string, partyId: string): Promise<Party | undefined> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.findActiveInTransaction(transaction, tenantId, partyId),
    );
  }

  /** Same lookup, inside a caller-owned transaction — for atomic source-document creation. */
  async findActiveInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    partyId: string,
  ): Promise<Party | undefined> {
    const [party] = await transaction
      .select()
      .from(parties)
      .where(
        and(eq(parties.tenantId, tenantId), eq(parties.id, partyId), eq(parties.status, 'ACTIVE')),
      )
      .limit(1);

    return party;
  }

  async updateInTransaction(
    transaction: TenantTransaction,
    command: UpdatePartyCommand,
  ): Promise<Party> {
    const before = await this.findByIdInTransaction(transaction, command.tenantId, command.partyId);
    if (before === undefined) {
      throw new PartyNotFoundError();
    }

    const values: Record<string, unknown> = {};
    if (command.input.type !== undefined) {
      values.type = command.input.type;
    }
    if (command.input.displayName !== undefined) {
      const displayName = normalizeTextForStorage(command.input.displayName);
      values.displayName = displayName;
      values.normalizedName = normalizeTextForSearch(displayName);
    }
    if (command.input.mobile !== undefined) {
      const mobile =
        command.input.mobile === null ? null : normalizeTextForStorage(command.input.mobile);
      values.mobile = mobile;
      values.normalizedMobile = mobile === null ? null : normalizeMobile(mobile);
    }
    if (command.input.nationalId !== undefined) {
      values.nationalId =
        command.input.nationalId === null
          ? null
          : normalizeTextForStorage(command.input.nationalId);
    }
    if (command.input.linkedTenantId !== undefined) {
      values.linkedTenantId = command.input.linkedTenantId;
    }
    if (command.input.notes !== undefined) {
      values.notes =
        command.input.notes === null ? null : normalizeTextForStorage(command.input.notes);
    }

    const [updated] = await transaction
      .update(parties)
      .set(values)
      .where(and(eq(parties.tenantId, command.tenantId), eq(parties.id, command.partyId)))
      .returning();
    const party = updated!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: command.tenantId,
      actorUserId: command.actorUserId,
      action: 'PARTY_UPDATED',
      entityType: 'party',
      entityId: party.id,
      beforeData: partyAuditData(before),
      afterData: partyAuditData(party),
      ipAddress: command.ipAddress ?? null,
      userAgent: command.userAgent ?? null,
    });

    return party;
  }

  async deactivateInTransaction(
    transaction: TenantTransaction,
    command: DeactivatePartyCommand,
  ): Promise<Party> {
    const before = await this.findByIdInTransaction(transaction, command.tenantId, command.partyId);
    if (before === undefined) {
      throw new PartyNotFoundError();
    }
    if (before.status === 'INACTIVE') {
      return before;
    }

    const [updated] = await transaction
      .update(parties)
      .set({ status: 'INACTIVE' })
      .where(and(eq(parties.tenantId, command.tenantId), eq(parties.id, command.partyId)))
      .returning();
    const party = updated!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: command.tenantId,
      actorUserId: command.actorUserId,
      action: 'PARTY_DEACTIVATED',
      entityType: 'party',
      entityId: party.id,
      beforeData: partyAuditData(before),
      afterData: partyAuditData(party),
      ipAddress: command.ipAddress ?? null,
      userAgent: command.userAgent ?? null,
    });

    return party;
  }

  private async findByIdInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    partyId: string,
  ): Promise<Party | undefined> {
    const [party] = await transaction
      .select()
      .from(parties)
      .where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId)))
      .limit(1);

    return party;
  }
}
