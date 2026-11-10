import { getAi } from "@/lib/ai";
import { embedPeople, peopleNeedingEmbeddings } from "@/lib/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "../client";

const STEP_SIZE = 100;

/**
 * Embeds every profile whose vector is missing or came from another model, so
 * prompt search can use similarity. Send `people/embeddings.backfill` (with
 * `{ force: true }` to redo all of them) after changing the embedding model.
 */
export const backfillEmbeddings = inngest.createFunction(
  { id: "backfill-embeddings", triggers: [{ event: EVENTS.embeddingsBackfill }], concurrency: { limit: 1 }, retries: 3 },
  async ({ event, step }) => {
    const ids = await step.run("find profiles to embed", () =>
      peopleNeedingEmbeddings(createAdminClient(), getAi().embedModel, { force: Boolean(event.data?.force) }),
    );
    let embedded = 0;
    for (let i = 0; i < ids.length; i += STEP_SIZE) {
      embedded += await step.run(`embed ${i + 1}-${Math.min(i + STEP_SIZE, ids.length)}`, () =>
        embedPeople(createAdminClient(), getAi(), ids.slice(i, i + STEP_SIZE)),
      );
    }
    return { embedded, model: getAi().embedModel };
  },
);
