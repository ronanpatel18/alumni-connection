import { getAi } from "@/lib/ai";
import { embedPeople, peopleNeedingEmbeddings } from "@/lib/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "../client";

const PER_RUN = 200;
const STEP_SIZE = 50;

/**
 * Every hour: new profiles (from an import, a claim or an administrator) get
 * their AI summary queued and their search embedding written, so nobody has to
 * run a script after adding people. Profiles embedded by a different model
 * than the one configured now are redone too. Does nothing when all are current.
 */
export const keepProfilesCurrent = inngest.createFunction(
  { id: "keep-profiles-current", triggers: [{ cron: "7 * * * *" }], concurrency: { limit: 1 }, retries: 2 },
  async ({ step }) => {
    // Summaries first: the summary job writes the embedding along with it.
    const unsummarized = await step.run("count profiles without a summary", async () => {
      const { count, error } = await createAdminClient()
        .from("people")
        .select("id", { count: "exact", head: true })
        .is("ai_summary", null)
        .neq("status", "opted_out");
      if (error) throw error;
      return count ?? 0;
    });
    if (unsummarized > 0) await step.sendEvent("queue summaries", { name: EVENTS.summaryBackfill, data: {} });

    const ids = await step.run("find profiles to embed", () => peopleNeedingEmbeddings(createAdminClient(), getAi().embedModel, { limit: PER_RUN }));
    let embedded = 0;
    for (let i = 0; i < ids.length; i += STEP_SIZE) {
      embedded += await step.run(`embed ${i + 1}-${Math.min(i + STEP_SIZE, ids.length)}`, () =>
        embedPeople(createAdminClient(), getAi(), ids.slice(i, i + STEP_SIZE)),
      );
    }
    return { summariesQueued: unsummarized, embedded, model: getAi().embedModel };
  },
);
