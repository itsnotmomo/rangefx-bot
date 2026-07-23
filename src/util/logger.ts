/**
 * Minimal structured (JSON-line) logger. Every line is a single JSON object so
 * Railway's log drain / any aggregator can parse it. No dependency, no config.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

interface Fields {
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: Fields): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...serialize(fields),
  };
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

/** BigInts and Errors are not JSON-serialisable by default — normalise them. */
function serialize(fields?: Fields): Fields {
  if (!fields) return {};
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'bigint') out[k] = v.toString();
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message, stack: v.stack };
    else out[k] = v;
  }
  return out;
}

export const log = {
  debug: (msg: string, fields?: Fields) => {
    if (process.env.LOG_LEVEL === 'debug') emit('debug', msg, fields);
  },
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};
