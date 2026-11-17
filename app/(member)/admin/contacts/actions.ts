"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contactProgress } from "@/lib/enrichment/contacts/run";
import { startContactSearch } from "@/lib/enrichment/contacts/start";
import { searchConfigured } from "@/lib/enrichment/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/viewer";

// One click's worth: what fits in the time a request gets where there's no background queue.
const BATCH = 10;

/** Searches for work emails and phone numbers for the next unclaimed profiles that haven't been searched. */
export async function findContacts() {
  await requireAdmin("/admin/contacts");
  if (!searchConfigured()) redirect("/admin/contacts?search=nosearch");
  let started = 0;
  try {
    const progress = await contactProgress(createAdminClient());
    // A batch already under way finishes first, so search allowances aren't spent twice.
    const batch = progress.running ? [] : progress.next.slice(0, BATCH);
    await startContactSearch(batch);
    started = batch.length;
  } catch {
    redirect("/admin/contacts?search=error");
  }
  revalidatePath("/admin/contacts");
  redirect(`/admin/contacts?search=${started}`);
}

/** Runs the search again for one person. */
export async function findContactsForPerson(formData: FormData) {
  await requireAdmin("/admin/contacts");
  const personId = String(formData.get("person_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(personId)) redirect("/admin/contacts?search=error");
  if (!searchConfigured()) redirect("/admin/contacts?search=nosearch");
  try {
    await startContactSearch([personId]);
  } catch {
    redirect("/admin/contacts?search=error");
  }
  revalidatePath("/admin/contacts");
  redirect("/admin/contacts?search=1");
}
