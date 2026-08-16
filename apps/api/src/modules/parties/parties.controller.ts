import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  createPartySchema,
  partyBalancesQuerySchema,
  partyListQuerySchema,
  partyStatementQuerySchema,
  updatePartySchema,
  uuidSchema,
} from '@gold/contracts';
import { ZodValidationPipe } from '../../shared/validation';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { PartiesService, PartyNotFoundError } from './parties.service';
import { PartyBalancesService } from './party-balances.service';
import { PartyBalanceReferenceQuoteNotFoundError } from './party-balances.errors';
import { PartyStatementsService } from './party-statements.service';
import type {
  CreatePartyInput,
  PartyBalances as PartyBalancesResponse,
  PartyBalancesQuery,
  Party as PartyResponse,
  PartyList as PartyListResponse,
  PartyListQuery,
  PartyStatement as PartyStatementResponse,
  PartyStatementQuery,
  UpdatePartyInput,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { Party } from '../../platform/database/schema';

interface AuditHttpRequest {
  readonly ip: string;
  readonly headers: Record<string, readonly string[] | string | undefined>;
}

function auditRequestMetadata(request: AuditHttpRequest): {
  readonly ipAddress: string;
  readonly userAgent: string | null;
} {
  const userAgent = request.headers['user-agent'];

  return { ipAddress: request.ip, userAgent: typeof userAgent === 'string' ? userAgent : null };
}

function toResponse(party: Party): PartyResponse {
  return {
    id: party.id,
    type: party.type,
    displayName: party.displayName,
    mobile: party.mobile,
    nationalId: party.nationalId,
    linkedTenantId: party.linkedTenantId,
    status: party.status,
    notes: party.notes,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
  };
}

/** Tenant-isolated counterparties. Every mutation is idempotent and audited. */
@Controller('parties')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PartiesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(PartyBalancesService) private readonly balances: PartyBalancesService,
    @Inject(PartyStatementsService) private readonly statements: PartyStatementsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createPartySchema)) body: CreatePartyInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() request: AuditHttpRequest,
  ): Promise<PartyResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: '/parties', body },
        execute: async (transaction) => {
          const party = await this.parties.createInTransaction(transaction, {
            tenantId,
            actorUserId: auth.sub,
            input: body,
            ...auditRequestMetadata(request),
          });
          return { status: HttpStatus.CREATED, body: toResponse(party) };
        },
      });
      return result.response.body;
    } catch (error) {
      return this.rethrowKnownError(error);
    }
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(partyListQuerySchema)) query: PartyListQuery,
  ): Promise<PartyListResponse> {
    const page = await this.parties.list(this.context.getTenantId(), query);

    return { ...page, items: page.items.map(toResponse) };
  }

  @Get(':id/balances')
  async getBalances(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(partyBalancesQuerySchema)) query: PartyBalancesQuery,
  ): Promise<PartyBalancesResponse> {
    try {
      return await this.balances.getBalances(this.context.getTenantId(), id, {
        at: query.at === undefined ? new Date() : new Date(query.at),
        referenceQuoteId: query.referenceQuoteId,
      });
    } catch (error) {
      if (
        error instanceof PartyNotFoundError ||
        error instanceof PartyBalanceReferenceQuoteNotFoundError
      ) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get(':id/statement')
  async getStatement(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(partyStatementQuerySchema)) query: PartyStatementQuery,
  ): Promise<PartyStatementResponse> {
    try {
      return await this.statements.getStatement(this.context.getTenantId(), id, {
        ...query,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      });
    } catch (error) {
      if (
        error instanceof PartyNotFoundError ||
        error instanceof PartyBalanceReferenceQuoteNotFoundError
      ) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get(':id')
  async getById(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<PartyResponse> {
    const party = await this.parties.findById(this.context.getTenantId(), id);
    if (party === undefined) {
      throw new NotFoundException('شخص مورد نظر پیدا نشد');
    }

    return toResponse(party);
  }

  @Patch(':id')
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updatePartySchema)) body: UpdatePartyInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() request: AuditHttpRequest,
  ): Promise<PartyResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'PATCH', path: `/parties/${id}`, body },
        execute: async (transaction) => {
          const party = await this.parties.updateInTransaction(transaction, {
            tenantId,
            actorUserId: auth.sub,
            partyId: id,
            input: body,
            ...auditRequestMetadata(request),
          });
          return { status: HttpStatus.OK, body: toResponse(party) };
        },
      });
      return result.response.body;
    } catch (error) {
      return this.rethrowKnownError(error);
    }
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() request: AuditHttpRequest,
  ): Promise<PartyResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: `/parties/${id}/deactivate`, body: {} },
        execute: async (transaction) => {
          const party = await this.parties.deactivateInTransaction(transaction, {
            tenantId,
            actorUserId: auth.sub,
            partyId: id,
            ...auditRequestMetadata(request),
          });
          return { status: HttpStatus.OK, body: toResponse(party) };
        },
      });
      return result.response.body;
    } catch (error) {
      return this.rethrowKnownError(error);
    }
  }

  private rethrowKnownError(error: unknown): never {
    if (error instanceof IdempotencyKeyConflictError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof PartyNotFoundError) {
      throw new NotFoundException(error.message);
    }
    throw error;
  }
}
