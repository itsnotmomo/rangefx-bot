import express from 'express';
import { webhookCallback } from 'grammy';
import { config, telegramWebhookToken } from './config/index.js';
import { log } from './util/logger.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/index.js';
import { buildBot } from './bot/index.js';
import { runtime } from './bot/runtime.js';
import { createStripeWebhookHandler } from './stripe/webhook.js';
import { scheduleGraceJob } from './jobs/grace-period.js';

async function main(): Promise<void> {
  // 1. Schema first — safe/idempotent, so every deploy self-heals.
  await runMigrations();

  // 2. Build + initialise the bot (init() fetches our @username for return links).
  const bot = buildBot();
  await bot.init();
  runtime.botUsername = bot.botInfo.username;
  log.info('bot initialised', { username: runtime.botUsername, id: bot.botInfo.id });

  await bot.api.setMyCommands([
    { command: 'start', description: 'Start / main menu' },
    { command: 'plans', description: 'View subscription plans' },
    { command: 'status', description: 'My subscription' },
    { command: 'support', description: 'Support & FAQ' },
  ]);

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
  app.use(telegramPath, webhookCallback(bot, 'express', { secretToken }));

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

  // 5. Daily grace-period job.
  scheduleGraceJob(bot.api);

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('fatal startup error', { error: err });
  process.exit(1);
});
