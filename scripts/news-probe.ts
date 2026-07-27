/**
 * Read-only RapidAPI calendar probe.
 *
 *   RAPIDAPI_KEY=... npx tsx scripts/news-probe.ts [hours]
 *
 * Answers two questions that can only be answered against a live response:
 *
 *   1. How close does a wide HIGH-impact window come to the 500-row ceiling?
 *   2. How does the API represent an event with no confirmed release time
 *      (the BOJ announcements)? Which field, if any, flags it — and is a
 *      placeholder time being presented as though it were real?
 *
 * Deliberately standalone: it makes ONE raw fetch, needs no DATABASE_URL, and
 * writes nothing. It does not go through the provider adapter because the
 * adapter discards the raw JSON, and the raw JSON is the whole point. It costs
 * one request against the plan (two if you pass a second window to compare).
 */

export {}; // top-level await requires this file to be a module

const KEY = process.env.RAPIDAPI_KEY?.trim();
const HOST = 'economic-calendar-api.p.rapidapi.com';
const BASE = `https://${HOST}/calendar`;
const LIMIT = 500;

if (!KEY) {
  console.error('RAPIDAPI_KEY is not set. Usage: RAPIDAPI_KEY=... npx tsx scripts/news-probe.ts [hours]');
  process.exit(1);
}

const hours = Number.parseInt(process.argv[2] ?? '168', 10);
if (Number.isNaN(hours) || hours < 1) {
  console.error(`Invalid hours: ${process.argv[2]}`);
  process.exit(1);
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** One request, mirroring exactly what RapidApiProvider.fetchUpcoming sends. */
async function fetchWindow(windowHours: number, volatility: string | null): Promise<Record<string, unknown>[]> {
  const from = new Date();
  const to = new Date(from.getTime() + windowHours * 3_600_000);
  const params = new URLSearchParams({
    startDate: isoDate(from),
    endDate: isoDate(to),
    limit: String(LIMIT),
  });
  if (volatility) params.set('volatility', volatility);

  const url = `${BASE}?${params.toString()}`;
  console.log(`\nGET ${url.replace(KEY!, '<key>')}`);
  const res = await fetch(url, {
    headers: { 'X-RapidAPI-Key': KEY!, 'X-RapidAPI-Host': HOST, Accept: 'application/json' },
  });
  console.log(`  HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`  body: ${(await res.text().catch(() => '')).slice(0, 400)}`);
    return [];
  }
  const json: unknown = await res.json();
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  for (const k of ['data', 'result', 'results', 'events', 'items']) {
    const v = (json as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      console.log(`  (rows were wrapped in "${k}")`);
      return v as Record<string, unknown>[];
    }
  }
  console.log(`  unrecognised shape: ${JSON.stringify(json).slice(0, 400)}`);
  return [];
}

function tally(rows: Record<string, unknown>[], key: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    const s = v === null || v === undefined ? '(null)' : String(v);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return m;
}

function printTally(label: string, m: Map<string, number>, limit = 15): void {
  console.log(`  ${label}:`);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  for (const [k, n] of sorted) console.log(`    ${String(k).slice(0, 60).padEnd(60)} ${n}`);
}

const rows = await fetchWindow(hours, 'HIGH');

console.log(`\n${'='.repeat(70)}\n1. ROW COUNT vs THE 500 CEILING (${hours}h, volatility=HIGH)\n${'='.repeat(70)}`);
console.log(`  rows returned : ${rows.length}`);
console.log(`  limit         : ${LIMIT}`);
console.log(`  headroom      : ${LIMIT - rows.length}`);
console.log(`  TRUNCATED     : ${rows.length >= LIMIT ? 'YES — the window is being cut short' : 'no'}`);
if (rows.length === 0) {
  console.log('\n  No rows — nothing further can be determined. Check the key/subscription.');
  process.exit(0);
}

// Does volatility=HIGH actually filter? If not, a wide window will blow the cap.
printTally('volatility values present (should be HIGH only)', tally(rows, 'volatility'));

const perDay = new Map<string, number>();
for (const r of rows) {
  const d = String(r['dateUtc'] ?? '').slice(0, 10);
  perDay.set(d, (perDay.get(d) ?? 0) + 1);
}
console.log('  rows per day:');
for (const [d, n] of [...perDay.entries()].sort()) console.log(`    ${d}  ${n}`);
const days = perDay.size || 1;
console.log(`  mean/day ${(rows.length / days).toFixed(1)} -> projected 30d ≈ ${Math.round((rows.length / days) * 30)}`);

console.log(`\n${'='.repeat(70)}\n2. EVERY FIELD THE API SENDS\n${'='.repeat(70)}`);
const keys = new Set<string>();
for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
console.log(`  ${[...keys].sort().join(', ')}`);

const suspicious = [...keys].filter((k) =>
  /tentative|confirm|tbd|provisional|estimat|approx|allday|all_day|scheduled|timeknown|hastime|precis/i.test(k),
);
console.log(`\n  fields whose NAME hints at tentativeness: ${suspicious.length ? suspicious.join(', ') : '(none)'}`);
for (const k of suspicious) printTally(`  values of ${k}`, tally(rows, k));

console.log(`\n${'='.repeat(70)}\n3. TIME-OF-DAY DISTRIBUTION (placeholder detection)\n${'='.repeat(70)}`);
const times = tally(rows, 'dateUtc');
const byTime = new Map<string, number>();
for (const [iso, n] of times) {
  const t = iso.length >= 16 ? iso.slice(11, 16) : '(no time)';
  byTime.set(t, (byTime.get(t) ?? 0) + n);
}
printTally('most common UTC times — a spike at one value suggests a placeholder', byTime, 20);
const midnight = byTime.get('00:00') ?? 0;
console.log(`  rows at exactly 00:00 UTC: ${midnight} (${((midnight / rows.length) * 100).toFixed(1)}%)`);

console.log(`\n${'='.repeat(70)}\n4. BOJ / CENTRAL-BANK ROWS, RAW\n${'='.repeat(70)}`);
const boj = rows.filter((r) => /boj|bank of japan|interest rate|rate decision|policy/i.test(String(r['name'] ?? '')));
console.log(`  matched ${boj.length} row(s)`);
for (const r of boj.slice(0, 10)) console.log(`\n${JSON.stringify(r, null, 2)}`);

console.log(`\n${'='.repeat(70)}\n5. ROWS AT 00:00 UTC, RAW (likely placeholders)\n${'='.repeat(70)}`);
const mid = rows.filter((r) => String(r['dateUtc'] ?? '').slice(11, 16) === '00:00');
console.log(`  matched ${mid.length} row(s)`);
for (const r of mid.slice(0, 5)) console.log(`\n${JSON.stringify(r, null, 2)}`);

console.log(`\n${'='.repeat(70)}\n6. TWO SAMPLE ROWS IN FULL (baseline for comparison)\n${'='.repeat(70)}`);
for (const r of rows.slice(0, 2)) console.log(`\n${JSON.stringify(r, null, 2)}`);
