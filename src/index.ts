import express from 'express';
import { webhookCallback } from 'grammy';
import { config, telegramWebhookToken } from './config/index.js';
import { log } from './util/logger.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/index.js';
import { buildBot } from './bot/index.js';
import { runtime } from './bot/runtime.js';
import { createStripeWebhookHandler } from './stripe/webhook.js';
import { safeCall } from './telegram/safe.js';
import { scheduleGraceJob } from './jobs/grace-period.js';
import { scheduleFollowupJob } from './jobs/followups.js';
import { scheduleNewsJobs } from './news/jobs.js';
import { activeBroadcastId } from './bot/broadcast.js';
import { reportInterruptedBroadcasts } from './bot/broadcast-flow.js';
import { setStatus } from './services/broadcasts.js';

/**
 * Webhook handler budget. grammY defaults to 10_000ms AND to throwing on
 * expiry — the combination that took the process down on Jul 27. Raised, and
 * paired with a non-throwing onTimeout below.
 */
const WEBHOOK_TIMEOUT_MS = 60_000;

/**
 * Process-level crash visibility, installed before anything else runs.
 *
 * The Jul 27 incident produced no log line at all: grammY reported the timeout
 * through the `debug` package (silent without DEBUG), Express discarded the
 * rejection, bot.catch() never saw it because it was raised outside
 * bot.handleUpdate, and there was no process handler. Fifteen minutes of the
 * outage was spent finding a crash that had left no trace.
 *
 * These handlers do not swallow anything — the process still exits non-zero so
 * Railway restarts it and fail-fast semantics hold. They guarantee that the
 * reason is written down first, including which broadcast was in flight.
 */
function installCrashHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled promise rejection — exiting', {
      reason: reason instanceof Error ? reason : { value: String(reason) },
      activeBroadcastId: activeBroadcastId(),
    });
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    log.error('uncaught exception — exiting', {
      error: err,
      activeBroadcastId: activeBroadcastId(),
    });
    process.exit(1);
  });
}

async function main(): Promise<void> {
  // 1. Schema first — safe/idempotent, so every deploy self-heals.
  await runMigrations();

  // 2. Build + initialise the bot (init() fetches our @username for return links).
  const bot = buildBot();
  await bot.init();
  runtime.botUsername = bot.botInfo.username;
  log.info('bot initialised', { username: runtime.botUsername, id: bot.botInfo.id });

  // Command menus: users typing "/" see the public list; admins additionally
  // see the admin tooling (registered per-chat for each ADMIN_USER_IDS).
  const publicCommands = [
    { command: 'start', description: 'Start / main menu' },
    { command: 'plans', description: 'Join The Compound' },
    { command: 'status', description: 'My subscription' },
    { command: 'faq', description: 'Questions, answered' },
    { command: 'support', description: 'Message the desk' },
    { command: 'results', description: 'The record' },
  ];
  const adminCommands = [
    { command: 'stats', description: 'Funnel, revenue, acquisition' },
    { command: 'broadcast', description: 'Message an audience' },
    { command: 'broadcast_status', description: 'Latest broadcast status' },
    { command: 'broadcast_resume', description: 'Resume an interrupted broadcast' },
    { command: 'reply', description: 'Answer a support message' },
    { command: 'find', description: 'Look up a user' },
    { command: 'news_status', description: 'Economic calendar status' },
    { command: 'news_here', description: 'Show this chat + topic id' },
  ];
  await bot.api.setMyCommands(publicCommands);
  for (const adminId of config.adminUserIds) {
    // Per-chat scope fails if the admin never opened the bot — never fatal.
    await safeCall('setMyCommands(admin)', () =>
      bot.api.setMyCommands([...publicCommands, ...adminCommands], {
        scope: { type: 'chat', chat_id: Number(adminId) },
      }),
    );
  }

  // 3. HTTP server.
  const app = express();
  app.disable('x-powered-by');

  // Stripe webhook needs the RAW body for signature verification — mount it
  // BEFORE any JSON body parser.
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), createStripeWebhookHandler(bot.api));

  // Health check for Railway.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', bot: runtime.botUsername });
  });
  app.get('/', (_req, res) => res.status(200).send('Range Compound bot'));

  // JSON parser for everything after this point (i.e. the Telegram webhook).
  app.use(express.json());

  const secretToken = telegramWebhookToken();
  const telegramPath = `/telegram/${secretToken}`;
  app.use(
    telegramPath,
    webhookCallback(bot, 'express', {
      secretToken,
      /**
       * grammY's default is onTimeout: 'throw' at 10_000ms. That rejects the
       * middleware promise; Express 4 does not await async middleware, so the
       * rejection becomes an unhandled rejection and Node terminates the
       * process. That is exactly what killed the Jul 27 broadcast — and
       * bot.catch() cannot see it, because the rejection is manufactured
       * outside bot.handleUpdate.
       *
       * 'return'-style handling via a callback: log loudly, resolve, let the
       * handler finish in the background. The timeout is now a diagnostic, not
       * a kill switch. No handler should come near 60s regardless — long work
       * (broadcasts) runs detached.
       */
      onTimeout: () =>
        log.error('telegram webhook handler timed out', {
          timeoutMs: WEBHOOK_TIMEOUT_MS,
          activeBroadcastId: activeBroadcastId(),
          hint: 'a handler is doing long work inline; it must be detached',
        }),
      timeoutMilliseconds: WEBHOOK_TIMEOUT_MS,
    }),
  );

  const server = app.listen(config.port, () => {
    log.info('http server listening', { port: config.port });
  });

  // 4. Register the Telegram webhook with Telegram (needs our public URL).
  if (config.publicUrl) {
    const webhookUrl = `${config.publicUrl.replace(/\/$/, '')}${telegramPath}`;
    try {
      await bot.api.setWebhook(webhookUrl, {
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      });
      log.info('telegram webhook registered', { url: webhookUrl });
    } catch (err) {
      log.error('failed to register telegram webhook', { error: err });
    }
  } else {
    log.warn('PUBLIC_URL not set — Telegram webhook NOT registered. Set PUBLIC_URL (or rely on RAILWAY_PUBLIC_DOMAIN).');
  }

  // 5. Any broadcast still marked 'running' was cut off mid-flight (the runner
  //    only leaves that state by completing). Flag it and DM the admins. It is
  //    NOT auto-resumed: a crash-restart loop would otherwise re-send on every
  //    boot, and resuming a mass send is a decision with real-world cost.
  await reportInterruptedBroadcasts(bot.api).catch((err) =>
    log.error('interrupted-broadcast check failed', { error: err }),
  );

  // 6. Cron jobs: daily grace-period reconciliation + lead follow-up delivery.
  scheduleGraceJob(bot.api);
  scheduleFollowupJob(bot.api);
  // Economic calendar. Self-gating: dormant unless NEWS_ENABLED is on AND
  // NEWS_CHAT_ID is set, so this posts nothing by default.
  scheduleNewsJobs(bot.api);

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    server.close();
    // A deploy restart mid-broadcast would otherwise leave the row 'running'
    // and look like a crash. Record it as interrupted while the pool is still
    // open, so the next boot reports it accurately and a resume is one command.
    const running = activeBroadcastId();
    if (running !== null) {
      log.warn('shutting down mid-broadcast — marking interrupted', { broadcastId: running, signal });
      await setStatus(running, 'interrupted').catch((err) =>
        log.error('could not mark broadcast interrupted on shutdown', { broadcastId: running, error: err }),
      );
    }
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

installCrashHandlers();

main().catch((err) => {
  log.error('fatal startup error', { error: err });
  process.exit(1);
});
