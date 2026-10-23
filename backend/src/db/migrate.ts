import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, useOwnerRole } from '../config/database';
import { logger } from '../config/logger';

// Works from both src/db (tsx) and dist/db (compiled).
const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');
const LOCK_ID = 774_200;

/** Applies pending SQL migrations in order, each one inside its own transaction. */
export async function migrate() {
  // DDL runs as the database owner; the API itself runs as the RLS-restricted role.
  useOwnerRole();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

    const applied = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      logger.info(`Applying migration ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    logger.info('Database schema is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch(async (err) => {
      logger.fatal({ err }, 'Migration failed');
      await pool.end();
      process.exit(1);
    });
}
