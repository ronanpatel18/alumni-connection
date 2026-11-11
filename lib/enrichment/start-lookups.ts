import "server-only";
import { after } from "next/server";
import { EVENTS, inngest } from "@/inngest/client";
import { getAi } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOOKUP_PROVIDER, runPersonLookup } from "./save-person";

export interface Lookup {
  personId: string;
  jobId: string;
}

/** A queued lookup row for each person, for startLookups(). */
export async function queueLookups(personIds: string[]): Promise<Lookup[]> {
  if (!personIds.length) return [];
  const { data, error } = await createAdminClient()
    .from("enrichment_jobs")
    .insert(personIds.map((id) => ({ person_id: id, kind: "full", status: "queued", provider: LOOKUP_PROVIDER })))
    .select("id, person_id")
    .returns<{ id: string; person_id: string }[]>();
  if (error) throw error;
  return data.map((job) => ({ personId: job.person_id, jobId: job.id }));
}

/**
 * Hands lookups to the background queue (Inngest). Where no queue is
 * reachable, they run here after the response is sent, two at a time.
 * Call from a server action or route handler.
 */
export async function startLookups(lookups: Lookup[], hint: string | null) {
  if (!lookups.length) return;
  try {
    await Promise.race([
      inngest.send(lookups.map((l) => ({ name: EVENTS.personLookup, data: { ...l, hint } }))),
      new Promise((_, reject) => setTimeout(() => reject(new Error("queue timeout")), 4000)),
    ]);
  } catch {
    after(async () => {
      const db = createAdminClient();
      const queue = [...lookups];
      await Promise.all(
        Array.from({ length: 2 }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) await runPersonLookup(db, getAi(), { ...next, hint });
        }),
      );
    });
  }
}
