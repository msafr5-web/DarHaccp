import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { env } from './env';
import { logger } from './logger';

// NUMERIC -> number (measurements), DATE -> 'YYYY-MM-DD' string (avoid timezone shifts).
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(types.builtins.DATE, (v) => v);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.DB_SSL ? { rejectUnauthorized: true } : undefined,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<Pool, 'query'> | PoolClient;

export function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params);
}

/** Request context propagated into PostgreSQL so audit triggers know who made the change. */
export interface DbContext {
  userId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Runs `fn` inside a transaction. The acting user / IP / request id are stored as
 * transaction-local settings that the `audit_row_change()` trigger reads, so every
 * INSERT / UPDATE / DELETE is attributed to a user without any extra application code.
 */
export async function withTransaction<T>(ctx: DbContext | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
