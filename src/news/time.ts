/**
 * Time primitives shared by the provider adapters and the quota ledger.
 *
 * Kept separate because both concerns are easy to get subtly wrong: a
 * timestamp parsed in the wrong zone is invisibly correct on a UTC server, and
 * a month boundary computed in the wrong zone silently shifts a billing reset.
 */

export interface ParsedInstant {
  at: Date;
  /**
   * Whether the source string carried an explicit zone (Z or ±HH:MM).
   *
   * Callers use this to police their provider contract: a vendor that
   * documents Z-suffixed UTC and then stops sending the Z has changed its
   * contract, and that should surface as a warning rather than as timestamps
   * that quietly drift by the server's offset.
   */
  explicitZone: boolean;
}

/**
 * Parse a timestamp that is *meant* to be UTC.
 *
 * Strings carrying an explicit zone are honoured as written. Offset-less
 * strings are interpreted as UTC deliberately — never handed to `new Date()`,
 * which would read them as process-local time. Returns null on anything
 * unrecognised rather than guessing.
 */
export function parseUtcInstant(raw: string | undefined | null): ParsedInstant | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const at = new Date(s);
    return Number.isNaN(at.getTime()) ? null : { at, explicitZone: true };
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?/.exec(s);
  if (!m) return null;

  const at = new Date(
    Date.UTC(
      Number(m[1]!),
      Number(m[2]!) - 1,
      Number(m[3]!),
      Number(m[4] ?? '0'),
      Number(m[5] ?? '0'),
      Number(m[6] ?? '0'),
      Number((m[7] ?? '0').padEnd(3, '0')),
    ),
  );
  return Number.isNaN(at.getTime()) ? null : { at, explicitZone: false };
}

/**
 * Start of the current UTC month.
 *
 * Computed in JS and passed explicitly into every quota query, rather than
 * relying on Postgres `date_trunc('month', now())` — that follows the database
 * session's TimeZone, so a non-UTC database would reset the billing cap on a
 * different day than the code believes.
 */
export function utcMonthStart(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** 'YYYY-MM' in UTC — the key used to send the cap notice exactly once a month. */
export function utcMonthKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}
