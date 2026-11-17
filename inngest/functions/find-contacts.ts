import { runContactSearch } from "@/lib/enrichment/contacts/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "../client";

/**
 * Looks for work emails and phone numbers for a batch of unclaimed profiles
 * (started from /admin/contacts). Findings are stored privately or queued for
 * an administrator; each person's outcome lands on their contact_searches row.
 */
export const findContactsJob = inngest.createFunction(
  { id: "find-contacts", triggers: [{ event: EVENTS.contactSearch }], concurrency: { limit: 1 }, retries: 0 },
  async ({ event, step }) =>
    step.run("search and save", () => runContactSearch(createAdminClient(), (event.data.personIds as unknown[]).map(String))),
);
