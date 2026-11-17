import "server-only";
import { after } from "next/server";
import { EVENTS, inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { markSearching, runContactSearch } from "./run";

/**
 * Starts a contact search for these profiles. They go to the background queue
 * (Inngest); where no queue is reachable, the search runs here after the
 * response is sent. Call from a server action or route handler.
 */
export async function startContactSearch(personIds: string[]) {
  if (!personIds.length) return;
  await markSearching(createAdminClient(), personIds);
  try {
    await Promise.race([
      inngest.send({ name: EVENTS.contactSearch, data: { personIds } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("queue timeout")), 4000)),
    ]);
  } catch {
    after(() => runContactSearch(createAdminClient(), personIds));
  }
}
