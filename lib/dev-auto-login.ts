/**
 * Local development convenience: sign every visitor in as one admin account
 * (DEV_AUTO_LOGIN_EMAIL) so the whole app can be browsed without magic links.
 *
 * Off unless ALL of these hold: `next dev` (NODE_ENV=development), Supabase
 * on a local address, and DEV_AUTO_LOGIN_EMAIL set. A production build can
 * never enable it.
 */
export function devAutoLoginEmail(): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return null;
  const email = process.env.DEV_AUTO_LOGIN_EMAIL?.trim().toLowerCase();
  return email || null;
}

export const DEV_LOGIN_PATH = "/auth/dev-login";
