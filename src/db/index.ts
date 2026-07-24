import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { required } from '../config/env.js';
import * as schema from './schema.js';

const { Pool } = pg;

/**
 * A single shared connection pool for the whole process. Railway's Postgres and
 * most managed providers require TLS; we enable it in production but allow plain
 * connections locally (DATABASE_URL to a local docker/postgres).
 *
 * Deliberately reads DATABASE_URL via the base env helper, NOT the full config:
 * standalone scripts (migrate, import-legacy) need a database and nothing else.
 * The bot's fail-fast on the full variable set is unaffected — its entrypoints
 * all import config/index.ts.
 */
const databaseUrl = required('DATABASE_URL');

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
    ? undefined
    : { rejectUnauthorized: false },
  max: 10,
});

export const db = drizzle(pool, { schema });

export { schema };
