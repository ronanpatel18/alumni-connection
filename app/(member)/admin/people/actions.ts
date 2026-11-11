"use server";

import { revalidatePath } from "next/cache";
import { searchConfigured } from "@/lib/enrichment/providers";
import { type AddResult, addPeopleByName } from "@/lib/enrichment/save-person";
import { queueLookups, startLookups } from "@/lib/enrichment/start-lookups";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeString } from "@/lib/validation";
import { requireAdmin } from "@/lib/viewer";

const MAX_NAMES = 25;

export type AddPeopleState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; results: AddResult[] };

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
  await startLookups(await queueLookups([personId]), hint);
  revalidatePath("/admin/people");
}
