import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { env } from './env';
import { logger } from './logger';

// NUMERIC -> number (measurements), DATE -> 'YYYY-MM-DD' string (avoid timezone shifts).
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(types.builtins.DATE, (v) => v);

/** Raw pool. Business code must use `query` / `db` / `withTransaction`, which apply the tenant scope. */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.DB_SSL ? { rejectUnauthorized: true } : undefined,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

// ---------------------------------------------------------------- multi-tenant scope

/**
 * Which company the current request acts for. Stored in AsyncLocalStorage so every query
 * issued while handling a request is automatically confined to that tenant by PostgreSQL
 * Row-Level Security (see migration 004). `bypass` is reserved for platform/system work.
 */
export interface TenantScope {
  tenantId: number | null;
  bypass: boolean;
}

const scopeStore = new AsyncLocalStorage<TenantScope>();

export const currentScope = (): TenantScope => scopeStore.getStore() ?? { tenantId: null, bypass: false };
export const runInTenant = <T>(tenantId: number, fn: () => T): T => scopeStore.run({ tenantId, bypass: false }, fn);
export const runAsSystem = <T>(fn: () => T): T => scopeStore.run({ tenantId: null, bypass: true }, fn);

/**
 * The API runs as a role WITHOUT BYPASSRLS so isolation is enforced by the database itself.
 * Migrations and the seed run as the owner (`useOwnerRole()`).
 */
let runtimeRole = env.DB_APP_ROLE;
export function useOwnerRole() {
  runtimeRole = '';
}

/**
 * Opens a transaction carrying the tenant scope as TRANSACTION-LOCAL settings.
 *
 * Never use session-level settings here: managed Postgres (Neon) sits behind PgBouncer in
 * transaction-pooling mode, where one server connection is shared by many clients between
 * transactions — a session setting could leak one company's scope into another request.
 * Local settings vanish at COMMIT/ROLLBACK, and a transaction is pinned to one server connection.
 * Values are validated (integer tenant id, regex-checked role) so they can be inlined, which
 * sends BEGIN and the settings in a single round trip.
 */
async function beginScoped(client: PoolClient, scope: TenantScope) {
  const tenant = scope.tenantId === null ? '' : String(scope.tenantId);
  if (tenant && !/^\d+$/.test(tenant)) throw new Error('Invalid tenant scope');
  const role = runtimeRole ? `, set_config('role', '${runtimeRole}', true)` : '';
  await client.query(
    `BEGIN; SELECT set_config('app.tenant_id', '${tenant}', true), set_config('app.bypass_rls', '${scope.bypass ? 'on' : ''}', true)${role}`,
  );
}

/** Anything that can run a query: the scoped `db` or a transaction client. */
export interface Queryable {
  query<R extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await beginScoped(client, currentScope());
    const result = await client.query<T>(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Scoped query runner (drop-in for the former pool usage). */
export const db: Queryable = { query };

/** Request context propagated into PostgreSQL so audit triggers know who made the change. */
export interface DbContext {
  userId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /** Overrides the ambient tenant scope for this transaction. */
  tenantId?: number;
  bypass?: boolean;
}

/**
 * Runs `fn` inside a transaction. The tenant scope and the acting user / IP / request id are
 * transaction-local settings: RLS confines the rows, and the `audit_row_change()` trigger
 * attributes every INSERT / UPDATE / DELETE to a user without extra application code.
 */
export async function withTransaction<T>(ctx: DbContext | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const ambient = currentScope();
    await beginScoped(client, {
      tenantId: ctx?.tenantId ?? ambient.tenantId,
      bypass: ctx?.bypass ?? ambient.bypass,
    });
    if (ctx) {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.client_ip', $2, true),
                set_config('app.user_agent', $3, true),
                set_config('app.request_id', $4, true)`,
        [ctx.userId ?? '', ctx.ip ?? '', (ctx.userAgent ?? '').slice(0, 300), ctx.requestId ?? ''],
      );
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) => logger.error({ rollbackErr }, 'Rollback failed'));
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}
