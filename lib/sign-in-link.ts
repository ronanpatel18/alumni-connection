import "server-only";
import { sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type SignInEmailResult = "sent" | "limited" | "failed";

/**
 * Emails a one-time sign-in link. The token comes from Supabase, but the email goes out
 * through lib/email.ts (HTTPS) instead of Supabase Auth's SMTP: that send runs inside a
 * 10-second request limit, and a slow mail server makes sign-in hang and then fail.
 */
export async function sendSignInEmail(email: string, next: string): Promise<SignInEmailResult> {
  const limit = await checkRateLimit("sign-in-email", email.toLowerCase(), { limit: 3, windowSec: 60 });
  if (!limit.allowed) return "limited";

  try {
    const admin = createAdminClient();
    // Create the account on first use: a link for an unknown email would be a sign-up
    // token, not a sign-in one. It stays unusable until the link is opened.
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error && created.error.code !== "email_exists") throw created.error;
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;

    const url = new URL("/auth/confirm", publicEnv.NEXT_PUBLIC_SITE_URL);
    url.searchParams.set("token_hash", link.data.properties.hashed_token);
    url.searchParams.set("type", "magiclink");
    url.searchParams.set("next", next);

    const sent = await sendEmail({
      to: email,
      subject: "Your Alumni Connect sign-in link",
      text: `Open this link to sign in to Alumni Connect:\n\n${url}\n\nIt works once and expires soon. If you didn't ask for it, you can ignore this email.\n`,
    });
    return sent ? "sent" : "failed";
  } catch (error) {
    console.error("[sign-in] could not send link:", (error as Error).message);
    return "failed";
  }
}
