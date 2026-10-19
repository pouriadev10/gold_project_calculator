import { ParseUUIDPipe, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ZodValidationPipe } from '../../shared/validation';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_METADATA_KEY } from '../auth/roles.decorator';
import type { ZodTypeAny } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** پارامتر ورودی یک مسیر — از دکوراتورهای `@Body`/`@Query`/`@Param` و pipeهایشان. */
export interface DiscoveredInput {
  readonly in: 'body' | 'query' | 'path';
  /** نام پارامتر تکی (`@Query('itemType', …)`)؛ `undefined` یعنی کل بدنه/query. */
  readonly name: string | undefined;
  /** schema ِ zod ِ همان `ZodValidationPipe` که سرور با آن اعتبارسنجی می‌کند. */
  readonly schema: ZodTypeAny | undefined;
  /** `ParseUUIDPipe` بدون zod. */
  readonly uuid: boolean;
}

export interface DiscoveredRoute {
  readonly method: HttpMethod;
  /** مسیر به سبک Nest، مثل `/parties/:id/statement`. */
  readonly path: string;
  readonly controller: string;
  readonly handler: string;
  readonly status: number;
  readonly authenticated: boolean;
  readonly roles: readonly string[];
  readonly inputs: readonly DiscoveredInput[];
}

const METHODS: Partial<Record<RequestMethod, HttpMethod>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const INPUT_LOCATIONS: Partial<Record<number, DiscoveredInput['in']>> = {
  [RouteParamtypes.BODY]: 'body',
  [RouteParamtypes.QUERY]: 'query',
  [RouteParamtypes.PARAM]: 'path',
};

export type Constructor = abstract new (...args: never[]) => unknown;

interface RouteArgument {
  readonly index: number;
  readonly data?: unknown;
  readonly pipes?: readonly unknown[];
}

function metadata<T>(key: string, target: object, property?: string): T | undefined {
  return (property === undefined
    ? Reflect.getMetadata(key, target)
    : Reflect.getMetadata(key, target, property)) as T | undefined;
}

/** ماژول‌های import‌شده؛ شکل dynamic module (`{ module }`) و `forwardRef` هم. */
function moduleClass(entry: unknown): Constructor | undefined {
  if (typeof entry === 'function') {
    return entry as Constructor;
  }
  if (typeof entry === 'object' && entry !== null) {
    const candidate = entry as { module?: unknown; forwardRef?: () => unknown };
    if (typeof candidate.forwardRef === 'function') {
      return moduleClass(candidate.forwardRef());
    }
    if (typeof candidate.module === 'function') {
      return candidate.module as Constructor;
    }
  }
  return undefined;
}

function joinPath(...parts: readonly string[]): string {
  const joined = parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment !== '')
    .join('/');
  return `/${joined}`;
}

function guardsOf(target: object, property?: string): readonly unknown[] {
  return metadata<readonly unknown[]>(GUARDS_METADATA, target, property) ?? [];
}

function inputsOf(controller: Constructor, handler: string): DiscoveredInput[] {
  const args = metadata<Record<string, RouteArgument>>(ROUTE_ARGS_METADATA, controller, handler) ?? {};

  return Object.entries(args)
    /*
     * کلید دکوراتورهای استاندارد `<paramtype>:<index>` است. دکوراتور سفارشی
     * (`@CurrentAuth`) کلید `<شناسه>__customRouteArgs__:<index>` دارد که اگر
     * شناسه با رقم شروع شود parseInt آن را یک paramtype ِ معتبر می‌خواند.
     */
    .filter(([key]) => /^\d+:\d+$/u.test(key))
    .map(([key, argument]) => ({ type: Number.parseInt(key.split(':')[0] ?? '', 10), argument }))
    .sort((left, right) => left.argument.index - right.argument.index)
    .flatMap(({ type, argument }) => {
      const location = INPUT_LOCATIONS[type];
      if (location === undefined) {
        return [];
      }
      const pipes = argument.pipes ?? [];
      const zodPipe = pipes.find((pipe): pipe is ZodValidationPipe<ZodTypeAny> => pipe instanceof ZodValidationPipe);
      return [
        {
          in: location,
          name: typeof argument.data === 'string' ? argument.data : undefined,
          schema: zodPipe?.schema,
          uuid: pipes.some((pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe),
        },
      ];
    });
}

function routesOf(controller: Constructor): DiscoveredRoute[] {
  const prefix = metadata<string>(PATH_METADATA, controller) ?? '';
  const classAuthenticated = guardsOf(controller).includes(JwtAuthGuard);
  const classRoles = metadata<readonly string[]>(ROLES_METADATA_KEY, controller) ?? [];
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype).flatMap((handler) => {
    const fn = prototype[handler];
    if (handler === 'constructor' || typeof fn !== 'function') {
      return [];
    }
    const requestMethod = metadata<RequestMethod>(METHOD_METADATA, fn);
    const path = metadata<string | string[]>(PATH_METADATA, fn);
    if (requestMethod === undefined || path === undefined) {
      return [];
    }
    const method = METHODS[requestMethod];
    if (method === undefined || Array.isArray(path)) {
      throw new Error(`unsupported route shape on ${controller.name}.${handler}`);
    }

    return [
      {
        method,
        path: joinPath(prefix, path),
        controller: controller.name,
        handler,
        status: metadata<number>(HTTP_CODE_METADATA, fn) ?? (method === 'POST' ? 201 : 200),
        authenticated: classAuthenticated || guardsOf(fn).includes(JwtAuthGuard),
        roles: metadata<readonly string[]>(ROLES_METADATA_KEY, fn) ?? classRoles,
        inputs: inputsOf(controller, handler),
      },
    ];
  });
}

/**
 * همه‌ی مسیرهای HTTP برنامه، مستقیم از metadata ِ دکوراتورهای Nest — همان
 * چیزی که Nest خودش برای ساخت router می‌خواند. بدون بالا آوردن برنامه یا
 * اتصال دیتابیس: فقط درخت `imports`/`controllers` ِ ماژول ریشه پیموده می‌شود.
 */
export function discoverRoutes(rootModule: Constructor): DiscoveredRoute[] {
  const visited = new Set<Constructor>();
  const controllers = new Set<Constructor>();
  const queue: Constructor[] = [rootModule];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const controller of metadata<Constructor[]>(MODULE_METADATA.CONTROLLERS, current) ?? []) {
      controllers.add(controller);
    }
    for (const entry of metadata<unknown[]>(MODULE_METADATA.IMPORTS, current) ?? []) {
      const imported = moduleClass(entry);
      if (imported !== undefined) queue.push(imported);
    }
  }

  return routesFromControllers([...controllers]);
}

/** همان، از فهرست کنترلرهای ثبت‌شده (مثلاً `ModulesContainer` ِ برنامه‌ی در حال اجرا). */
export function routesFromControllers(controllers: readonly Constructor[]): DiscoveredRoute[] {
  return [...new Set(controllers)]
    .flatMap(routesOf)
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

export function routeKey(route: { readonly method: string; readonly path: string }): string {
  return `${route.method} ${route.path}`;
}
