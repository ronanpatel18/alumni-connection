import { getAi, factsHash } from "@/lib/ai";
import { embeddingText, loadProfileFacts } from "@/lib/profile-facts";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "../client";

/**
 * Writes a profile's AI summary and embedding from its stored facts.
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
    const personId = String(event.data.personId);
    const db = createAdminClient();

    const loaded = await step.run("load facts", () => loadProfileFacts(db, personId));
    if (!loaded) return { status: "not_found" };

    const hash = factsHash(loaded.facts);
    if (hash === loaded.summaryInputHash && !event.data.force) return { status: "unchanged" };

    const result = await step.run("summarize and embed", async () => {
      const ai = getAi();
      const summary = await ai.summarizeProfile(loaded.facts);
      const [embedding] = await ai.embed([embeddingText(loaded.facts, summary.summary)]);
      return { ...summary, embedding };
    });

    await step.run("save", async () => {
      const { error } = await db
        .from("people")
        .update({
          ai_summary: result.summary,
          summary_input_hash: hash,
          embedding: JSON.stringify(result.embedding),
        })
        .eq("id", personId);
      if (error) throw error;

      await db.from("field_provenance").upsert(
        { person_id: personId, field: "ai_summary", source: "ai", confidence: result.confidence, fetched_at: new Date().toISOString() },
        { onConflict: "person_id,field,source" },
      );
      await db.from("enrichment_jobs").insert({
        person_id: personId,
        kind: "summary",
        status: result.confidence < 0.5 ? "needs_review" : "succeeded",
        provider: result.model,
        attempts: 1,
        finished_at: new Date().toISOString(),
      });
    });

    return { status: "summarized", model: result.model, confidence: result.confidence };
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
        .is("ai_summary", null)
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
