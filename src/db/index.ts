import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config/index.js';
import * as schema from './schema.js';

const { Pool } = pg;

/**
 * A single shared connection pool for the whole process. Railway's Postgres and
 * most managed providers require TLS; we enable it in production but allow plain
 * connections locally (DATABASE_URL to a local docker/postgres).
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1')
    ? undefined
    : { rejectUnauthorized: false },
  max: 10,
});

export const db = drizzle(pool, { schema });

export { schema };
