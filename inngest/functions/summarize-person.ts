import { getAi } from "@/lib/ai";
import { summarizePerson as writeSummary } from "@/lib/summaries";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "../client";

/**
 * Writes a profile's three-bullet summary and embedding from its stored facts.
 * Skips the model entirely when the facts haven't changed since the last run.
 */
export const summarizePerson = inngest.createFunction(
  {
    id: "summarize-person",
    triggers: [{ event: EVENTS.summaryRequested }],
    concurrency: { limit: 5 },
    retries: 3,
  },
  async ({ event, step }) => {
    const status = await step.run("summarize and save", () =>
      writeSummary(createAdminClient(), getAi(), String(event.data.personId), { force: Boolean(event.data.force) }),
    );
    return { status };
  },
);

/** Queues summaries for every profile that doesn't have one yet, in batches. */
export const backfillSummaries = inngest.createFunction(
  { id: "backfill-summaries", triggers: [{ event: EVENTS.summaryBackfill }] },
  async ({ step }) => {
    const ids = await step.run("find profiles without summaries", async () => {
      const { data, error } = await createAdminClient()
        .from("people")
        .select("id")
        .or("ai_summary.is.null,summary_input_hash.is.null")
        .neq("status", "opted_out")
        .limit(5000);
      if (error) throw error;
      return data.map((row) => row.id as string);
    });

    for (let i = 0; i < ids.length; i += 500) {
      await step.sendEvent(
        `queue batch ${i / 500 + 1}`,
        ids.slice(i, i + 500).map((personId) => ({ name: EVENTS.summaryRequested, data: { personId } })),
      );
    }
    return { queued: ids.length };
  },
);
