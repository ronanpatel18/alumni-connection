import { drainNotifications } from "@/lib/notifications";
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
