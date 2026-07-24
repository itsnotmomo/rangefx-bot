import 'dotenv/config';

/**
 * Base env helpers, dependency-free. Split out of config/index.ts so modules
 * that need a single variable (e.g. the DB pool needs only DATABASE_URL) can
 * validate just that one without triggering full-app config validation —
 * which is what lets scripts/import-legacy.ts run with nothing but a
 * DATABASE_URL. The bot itself still fails fast on any missing variable:
 * every app entrypoint imports config/index.ts, which validates everything.
 */

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export function boolOf(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(raw);
}

export function intOf(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  return n;
}
