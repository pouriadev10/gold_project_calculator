import { Client } from 'pg';

/**
 * One statement exactly as the driver sent it. `appRole` is true when it ran
 * inside a tenant transaction (after `SET LOCAL ROLE gold_app`), so a replay
 * can use the same role and therefore the same RLS plan.
 */
export type RecordedQuery = {
  readonly text: string;
  readonly values: readonly unknown[];
  readonly appRole: boolean;
};

type QueryFunction = (...args: unknown[]) => unknown;

let active: RecordedQuery[] | undefined;
let installed = false;
/** Clients currently inside a transaction that switched to the app role. */
const clientsInAppRole = new WeakSet<object>();

function queryText(config: unknown): string | undefined {
  if (typeof config === 'string') {
    return config;
  }
  if (typeof config === 'object' && config !== null && 'text' in config) {
    return String((config as { readonly text: unknown }).text);
  }
  return undefined;
}

function queryValues(config: unknown, values: unknown): readonly unknown[] {
  if (typeof config === 'object' && config !== null && 'values' in config) {
    const own = (config as { readonly values?: unknown }).values;
    if (Array.isArray(own)) {
      return own;
    }
  }
  return Array.isArray(values) ? values : [];
}

function track(client: object, text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const inAppRole = clientsInAppRole.has(client);
  if (normalized.startsWith('set local role')) {
    clientsInAppRole.add(client);
  } else if (normalized === 'commit' || normalized === 'rollback') {
    clientsInAppRole.delete(client);
  }
  return inAppRole;
}

/**
 * Wraps `pg.Client#query` once per process so a benchmark can see every SQL
 * statement a request issues — Drizzle, transactions and RLS setup included.
 * Recording is off unless `recordQueries` is running, so seeding is unaffected.
 */
export function installQueryRecorder(): void {
  if (installed) {
    return;
  }
  const prototype = Client.prototype as unknown as { query: QueryFunction };
  const original = prototype.query;
  prototype.query = function recordedQuery(this: object, ...args: unknown[]): unknown {
    const text = queryText(args[0]);
    if (text !== undefined) {
      const appRole = track(this, text);
      active?.push({ text, values: queryValues(args[0], args[1]), appRole });
    }
    return original.apply(this, args);
  };
  installed = true;
}

/** Runs `work` and returns every statement sent while it ran. Not re-entrant. */
export async function recordQueries<T>(
  work: () => Promise<T>,
): Promise<{ readonly result: T; readonly queries: readonly RecordedQuery[] }> {
  if (active !== undefined) {
    throw new Error('recordQueries is not re-entrant');
  }
  const queries: RecordedQuery[] = [];
  active = queries;
  try {
    return { result: await work(), queries };
  } finally {
    active = undefined;
  }
}

/** Transaction plumbing and RLS setup, not domain queries. */
export function isInfrastructureQuery(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === 'begin' ||
    normalized === 'commit' ||
    normalized === 'rollback' ||
    normalized.startsWith('set local role') ||
    normalized.startsWith('savepoint') ||
    normalized.startsWith('release savepoint') ||
    normalized.includes('set_config(')
  );
}
