import { getAi } from "@/lib/ai";
import { runPersonLookup } from "@/lib/enrichment/save-person";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "../client";

/**
 * Builds a profile for someone an administrator added by name: searches the
 * web for their class year, work history and location, and saves what the
 * sources state. The result lands on the enrichment_jobs row the admin page reads.
 */
export const lookupPersonJob = inngest.createFunction(
  { id: "lookup-person", triggers: [{ event: EVENTS.personLookup }], concurrency: { limit: 3 }, retries: 1 },
  async ({ event, step }) =>
    step.run("search and save", () =>
      runPersonLookup(createAdminClient(), getAi(), {
        personId: String(event.data.personId),
        jobId: String(event.data.jobId),
        hint: event.data.hint ? String(event.data.hint) : null,
      }),
    ),
);
