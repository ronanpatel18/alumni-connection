import "server-only";
import { sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Emails any notifications not yet emailed (the notifications table is the
 * outbox). Called right after the actions that create them; in production an
 * Inngest job can run it too. Emails name who and what, link back to the app,
 * and never include anyone's email address or the message itself.
 */
export async function deliverNotifications(limit = 25): Promise<number> {
  const admin = createAdminClient();
  const { data: pending } = await admin
    .from("notifications")
    .select("id, user_id, title, link")
    .is("emailed_at", null)
    .order("created_at")
    .limit(limit);
  if (!pending?.length) return 0;

  const { data: members } = await admin
    .from("members")
    .select("user_id, email")
    .in("user_id", [...new Set(pending.map((n) => n.user_id as string))]);
  const emailOf = new Map((members ?? []).map((m) => [m.user_id as string, m.email as string | null]));

  let sent = 0;
  for (const n of pending) {
    const to = emailOf.get(n.user_id as string);
    const url = new URL(n.link as string, publicEnv.NEXT_PUBLIC_SITE_URL).toString();
    const ok = to
      ? await sendEmail({
          to,
          subject: n.title as string,
          text: `${n.title}.\n\nOpen it on Alumni Connect:\n${url}\n\nReplies happen in Alumni Connect, so your email address stays private.\n`,
        })
      : false;
    // Sent, or nowhere to send it: done. A failed send stays in the outbox for the next run.
    if (ok || !to) await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
    if (ok) sent++;
  }
  return sent;
}
