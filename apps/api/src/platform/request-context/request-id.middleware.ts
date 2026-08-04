import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER } from './request-id';
import type { MountedRequest } from './request-path';

interface WritableRequestId extends MountedRequest {
  requestId?: string;
}

/**
 * نخستین middleware هر درخواست. شناسه را خود سرور می‌سازد، نه کلاینت، تا
 * کاربر نتواند correlation لاگِ درخواست دیگری را جعل کند.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: MountedRequest, res: ServerResponse, next: (error?: unknown) => void): void {
    const requestId = randomUUID();
    (req as WritableRequestId).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
