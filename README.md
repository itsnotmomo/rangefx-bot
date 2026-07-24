# Range Compound bot

A Telegram subscription bot for **Range Compound**: Stripe handles billing,
the bot gates access to a private Telegram group, and an access layer keeps
"who is allowed in" decoupled from Stripe so future products (courses, ebooks,
other groups) can reuse the same plumbing.

- **Runtime:** Node ≥ 20, TypeScript (ESM), run directly with `tsx`.
- **Framework:** [grammY](https://grammy.dev) (Telegram) + Express (webhooks).
- **Billing:** Stripe Checkout + Billing Portal + webhooks.
- **Storage:** Postgres via [Drizzle ORM](https://orm.drizzle.team).

## Architecture at a glance

| Concern | Table | Notes |
| --- | --- | --- |
| Identity + funnel | `users` | one row per Telegram account; first-touch funnel timestamps and `acquisition_source` |
| Billing state | `subscriptions` | one row per Stripe subscription |
| **Access** | `access_grants` | source of truth for "who's allowed into resource X"; decoupled from Stripe |
| Lead follow-ups | `followups` | at most two scheduled touches per non-paying lead, then permanent silence |
| Audit / idempotency | `events` | append-only; unique `stripe_event_id` gives webhook idempotency for free |

The HTTP server exposes:

- `POST /stripe/webhook` — Stripe events (raw body, signature-verified).
- `POST /telegram/<secret>` — Telegram webhook (secret token derived or set).
- `GET /health` — health check for Railway.

Two cron jobs run inside the process:

- `GRACE_CRON` (daily) reconciles `past_due` subscriptions: a warning DM on
  day 1, removal from the group once `GRACE_DAYS` have passed.
- `FOLLOWUP_CRON` (every 10 minutes) delivers lead follow-ups: a user who viewed
  plans or opened checkout without paying gets one message at +1h and one at
  +24h — two touches maximum, ever. Paying (or already holding access) cancels
  anything pending.

Support is a real relay: any plain text a user sends the bot is forwarded to
every `ADMIN_USER_IDS` with name, id, and subscription status. Admins answer by
**replying natively** to the forwarded message (routed via `support_routes`), or
with `/reply <telegram_user_id> <message>` as a fallback. Both directions are
logged in `events`.

Admin tooling: `/stats` (funnel, revenue, acquisition), `/find <username | id |
name>` (user lookup with plan, source, funnel stage), and an interactive
`/broadcast` — audience picker with live counts (all / leads / churned /
active), text or photo+caption, preview, confirm, throttled send with progress,
and automatic exclusion of users who blocked the bot (`users.blocked_at`).
`/cancel` aborts the flow at any step. Command menus are registered on boot:
public commands for everyone, the admin set additionally scoped to each admin's
chat.

`/start` deep-link payloads (e.g. `t.me/<bot>?start=website`) are stored as
`users.acquisition_source` on first start; `/stats` breaks down conversion by
source.

Admins are DM'd on every `/start`: a "new user" card (first real start ever —
the atomic null→set transition on `users.first_started_at`; legacy-imported
rows count as new) or a "user returned" card with lead/active/churned status.
Stripe checkout returns never notify. Above ~30 starts/minute the notifier
switches to per-minute summaries until the burst ebbs. `NOTIFY_NEW_USERS=false`
silences it entirely.

> **Copy:** all user-facing strings live in `src/bot/content.ts` behind a
> `t(key)` helper (English dictionary; Italian can be added later without
> touching handlers). Track-record figures mirror the stats section of
> rangecompound.com — update both together, never one.

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Fill in every required variable — see `.env.example` for the full list.
   `config` validates them at startup, so a missing value fails fast. You'll
   need a Telegram bot token (from [@BotFather](https://t.me/BotFather)), your
   group's chat id, Stripe test keys + price ids, and a Postgres `DATABASE_URL`.

3. **Provision Postgres and run migrations**

   Point `DATABASE_URL` at any Postgres instance (local Docker, Railway, etc.).
   Migrations are forward-only and idempotent:

   ```bash
   npm run migrate
   ```

   (Boot also runs migrations automatically, so every deploy self-heals.)

4. **Run the bot**

   ```bash
   npm run dev     # tsx watch, reloads on change
   # or
   npm start       # one-off run
   ```

   Without a public HTTPS URL the Telegram webhook can't be registered. For
   local development expose the port with a tunnel (e.g. `ngrok http 3000`) and
   set `PUBLIC_URL` to the tunnel URL, or drive the bot through Railway.

5. **Typecheck**

   ```bash
   npm run typecheck
   ```

## Importing legacy members

Seed the database from a pre-bot member export. The CSV is **semicolon**-
delimited with the columns:

```
date;userId;name;email;status;referredByAffiliateId
```

`userId` is the Telegram user id. A header row is optional (auto-detected). The
`status` column uses the InviteMember values `lead` / `customer` / `churned`.

```bash
npm run import-legacy -- ./path/to/legacy.csv

# Preview counts without writing anything (needs only the CSV — no env):
npm run import-legacy -- --dry-run ./path/to/legacy.csv
```

- Users are upserted on `telegram_user_id` with `source='legacy_import'`.
- **Every imported user is a lead.** No access grants, no subscription rows,
  `first_started_at` stays null — their first real `/start` notifies admins as
  a new user, and they fall into the "leads" broadcast audience.
- The raw CSV status (`lead` / `customer` / `churned`) is preserved verbatim in
  `users.legacy_status` — purely informational (shown in `/find`, usable for
  future segmentation), with no behavioral effect anywhere.
- **Idempotent:** re-running never duplicates users, never rewrites a record's
  origin/creation date, and only fills blank profile fields; `legacy_status`
  alone is refreshed by a newer export.
- `--dry-run` reports rows read, valid ids, duplicates collapsed, invalid rows
  skipped, and `wouldGrant` (always 0 under this policy) — then exits without
  touching the database.

> `*.csv` is gitignored — keep member exports out of the repo.

## Railway deploy

The app is a single web service.

1. **Create the project & Postgres**
   - New Railway project → add a **PostgreSQL** plugin.
   - Add your app service from this repo (GitHub or `railway up`).

2. **Environment variables**
   - Set every required variable from `.env.example` in the service's
     **Variables** tab.
   - Reference the database with `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
   - `PORT` is provided by Railway. `PUBLIC_URL` is derived automatically from
     `RAILWAY_PUBLIC_DOMAIN`, so you can leave it unset once a public domain is
     attached.

3. **Networking**
   - Under **Settings → Networking**, generate a public domain. This is what
     lets the bot register its Telegram webhook and receive Stripe events.

4. **Start command**
   - Default `npm start` runs the server. Migrations run automatically on boot,
     so no separate release step is required.

5. **Deploy & verify**
   - Deploy, then check the logs for `http server listening`,
     `bot initialised`, and `telegram webhook registered`.
   - `GET https://<your-domain>/health` should return `{"status":"ok"}`.

To run the legacy import against the production database, use a Railway shell
(or run locally with `DATABASE_URL` pointed at the Railway Postgres):

```bash
railway run npm run import-legacy -- ./legacy.csv
```

## Stripe webhook configuration

1. **Create the endpoint**
   - Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
   - URL: `https://<your-domain>/stripe/webhook`.

2. **Select events**
   The dispatcher (`src/stripe/handlers.ts`) handles exactly these — subscribe to
   all five; any other delivered event is safely ignored:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

3. **Copy the signing secret**
   - Reveal the endpoint's **Signing secret** (`whsec_...`) and set it as
     `STRIPE_WEBHOOK_SECRET`. The webhook is verified against the **raw** request
     body, so this must match exactly.

4. **Price ids**
   - Create three recurring prices (monthly / quarterly / annual) and set
     `PRICE_MONTHLY`, `PRICE_QUARTERLY`, `PRICE_ANNUAL`. These map back to plan
     keys when reconciling webhooks.

5. **Local testing**
   Use the Stripe CLI to forward events to your machine:

   ```bash
   stripe listen --forward-to localhost:3000/stripe/webhook
   ```

   The CLI prints a `whsec_...` secret — use it as `STRIPE_WEBHOOK_SECRET` while
   testing locally.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with `tsx watch` (reloads on change) |
| `npm start` | Run the server once |
| `npm run build` | Typecheck via `tsc --noEmit` |
| `npm run typecheck` | Same as build — no emit |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run import-legacy -- <csv>` | Import legacy members (see above) |
