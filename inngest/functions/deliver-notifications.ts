import { drainNotifications } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "../client";

/**
 * Sends anything the actions didn't: failed emails coming due again, and any
 * left by a run that died. Each row tracks its own retries, so a failed run
 * needs no retry of its own; the next tick picks up where it left off.
 */
export const deliverNotificationsJob = inngest.createFunction(
  { id: "deliver-notifications", triggers: [{ cron: "*/5 * * * *" }], concurrency: { limit: 1 }, retries: 0 },
  async ({ step }) => step.run("deliver due notifications", () => drainNotifications()),
);

/** Every hour: follow-ups that have come due become reminders, which the job above emails. */
export const queueFollowUpReminders = inngest.createFunction(
  { id: "queue-follow-up-reminders", triggers: [{ cron: "0 * * * *" }], concurrency: { limit: 1 }, retries: 1 },
  async ({ step }) =>
    step.run("queue reminders", async () => {
      const { data, error } = await createAdminClient().rpc("queue_follow_up_reminders");
      if (error) throw error;
      return { reminders: data as number };
    }),
);
