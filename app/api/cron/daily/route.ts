import { getAi } from "@/lib/ai";
import { drainNotifications } from "@/lib/notifications";
import { summarizeMissing } from "@/lib/summaries";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Once a day (vercel.json): turn follow-ups that have come due into reminders,
 * send any notification emails still waiting, and write summaries for new
 * profiles. Inngest does the same more
 * often where it's set up; this keeps reminders working without it.
 * Vercel calls this with "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const { data: reminders, error } = await createAdminClient().rpc("queue_follow_up_reminders");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const sent = await drainNotifications();
  // Profiles added since yesterday get their summary here where no background queue runs.
  const summaries = await summarizeMissing(createAdminClient(), getAi(), { limit: 15 }).catch(() => null);
  return Response.json({ reminders, ...sent, summaries });
}
