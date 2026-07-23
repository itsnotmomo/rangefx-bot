/**
 * Small mutable holder for runtime facts learned after boot (e.g. the bot's own
 * @username, needed to build `t.me/<bot>` return links for Stripe Checkout).
 */
export const runtime: { botUsername: string | null } = {
  botUsername: null,
};

/** A `t.me/<bot>` deep link, or the group as a fallback. */
export function botDeepLink(): string {
  return runtime.botUsername ? `https://t.me/${runtime.botUsername}` : 'https://t.me';
}
