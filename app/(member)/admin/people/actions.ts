"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { EVENTS, inngest } from "@/inngest/client";
import { getAi } from "@/lib/ai";
import { searchConfigured } from "@/lib/enrichment/providers";
import { type AddResult, addPeopleByName, LOOKUP_PROVIDER, runPersonLookup } from "@/lib/enrichment/save-person";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeString } from "@/lib/validation";
import { requireAdmin } from "@/lib/viewer";

const MAX_NAMES = 25;

export type AddPeopleState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; results: AddResult[] };

interface Lookup {
  personId: string;
  jobId: string;
}

/**
 * Hands lookups to the background queue (Inngest). Where no queue is
 * reachable, they run here after the response is sent, two at a time.
 */
async function startLookups(lookups: Lookup[], hint: string | null) {
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

/** Creates a profile for each new name and starts finding their class year, work history and location. */
export async function addPeople(_prev: AddPeopleState, formData: FormData): Promise<AddPeopleState> {
  const viewer = await requireAdmin("/admin/people");
  revalidatePath("/admin/people");
  const names = String(formData.get("names") ?? "")
    .split(/\r?\n/)
    .map((line) => sanitizeString(line).slice(0, 120))
    .filter(Boolean);
  const hint = sanitizeString(String(formData.get("hint") ?? "")).slice(0, 200) || null;
  if (!names.length) return { status: "error", message: "Enter at least one name." };
  if (names.length > MAX_NAMES) return { status: "error", message: `Add up to ${MAX_NAMES} people at a time. You entered ${names.length}.` };
  if (!searchConfigured()) return { status: "error", message: "No web search is set up, so nothing could be looked up. Add a search key first." };

  let results: AddResult[];
  try {
    results = await addPeopleByName(createAdminClient(), names, viewer.userId);
  } catch {
    return { status: "error", message: "The profiles couldn’t be created. Try again." };
  }
  await startLookups(
    results.flatMap((r) => (r.status === "added" ? [{ personId: r.personId, jobId: r.jobId }] : [])),
    hint,
  );
  return { status: "done", results };
}

/** Runs the lookup again for one person, optionally with something more to go on. */
export async function searchAgain(formData: FormData) {
  await requireAdmin("/admin/people");
  const personId = String(formData.get("person_id") ?? "");
  const hint = sanitizeString(String(formData.get("hint") ?? "")).slice(0, 200) || null;
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return;
  const { data: job } = await createAdminClient()
    .from("enrichment_jobs")
    .insert({ person_id: personId, kind: "full", status: "queued", provider: LOOKUP_PROVIDER })
    .select("id")
    .single<{ id: string }>();
  if (job) await startLookups([{ personId, jobId: job.id }], hint);
  revalidatePath("/admin/people");
}
