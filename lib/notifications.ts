import "server-only";
import { canSendEmail, sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH = 25;
const MAX_BATCHES = 8;
const MAX_ATTEMPTS = 5;
/** Wait after each failed attempt; the last attempt has no wait because it's final. */
const RETRY_MINUTES = [5, 30, 120, 720];

interface Claimed {
  id: number;
  user_id: string;
  kind: string;
  title: string;
  link: string;
  attempts: number;
}

/** What to record after a failed send: when to try again, or that it's given up. Exported for tests. */
export function afterFailure(attempts: number, now = new Date()) {
  if (attempts >= MAX_ATTEMPTS) return { failed_at: now.toISOString(), claimed_until: null };
  const minutes = RETRY_MINUTES[attempts - 1] ?? RETRY_MINUTES[RETRY_MINUTES.length - 1];
  return { next_attempt_at: new Date(now.getTime() + minutes * 60_000).toISOString(), claimed_until: null };
}

/**
 * Emails one batch of due notifications (the notifications table is the outbox).
 * Called right after the actions that create them, and by a scheduled job that
 * retries anything that failed. Rows are claimed first, so overlapping runs can't
 * send the same one. Emails name who and what, link back to the app, and never
 * include anyone's email address or the message itself.
 */
export async function deliverNotifications(limit = BATCH): Promise<{ claimed: number; sent: number }> {
  // Claiming spends an attempt, so nothing is claimed until a send is possible.
  if (!canSendEmail()) {
    console.warn("[notifications] no email transport configured; leaving the outbox for later");
    return { claimed: 0, sent: 0 };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_notifications", { p_limit: limit, p_max_attempts: MAX_ATTEMPTS });
  if (error) throw error;
  const claimed = (data ?? []) as Claimed[];
  if (!claimed.length) return { claimed: 0, sent: 0 };

  const { data: members } = await admin
    .from("members")
    .select("user_id, email")
    .in("user_id", [...new Set(claimed.map((n) => n.user_id))]);
  const emailOf = new Map((members ?? []).map((m) => [m.user_id as string, m.email as string | null]));

  let sent = 0;
  for (const n of claimed) {
    const to = emailOf.get(n.user_id);
    const url = new URL(n.link, publicEnv.NEXT_PUBLIC_SITE_URL).toString();
    const ok = to
      ? await sendEmail({
          to,
          subject: n.title,
          text: `${n.title}.\n\nOpen it on Alumni Connect:\n${url}\n${n.kind === "claim_approved" ? "" : "\nReplies happen in Alumni Connect, so replying doesn’t share your email address.\n"}`,
          // Covers a run that dies after sending but before recording it below.
          idempotencyKey: `notification/${n.id}`,
        })
      : false;
    const now = new Date();
    const result = ok
      ? { emailed_at: now.toISOString(), claimed_until: null }
      : to
        ? afterFailure(n.attempts, now)
        : { failed_at: now.toISOString(), claimed_until: null }; // Nowhere to send it, now or later.
    await admin.from("notifications").update(result).eq("id", n.id);
    if (ok) sent++;
  }
  return { claimed: claimed.length, sent };
}

/** Works through everything due, up to a limit that keeps one run inside a function timeout. */
export async function drainNotifications(): Promise<{ claimed: number; sent: number }> {
  const total = { claimed: 0, sent: 0 };
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { claimed, sent } = await deliverNotifications();
    total.claimed += claimed;
    total.sent += sent;
    if (claimed < BATCH) break;
  }
  return total;
}
