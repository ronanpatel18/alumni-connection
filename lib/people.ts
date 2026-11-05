import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Which of these people the viewer has saved. */
export async function savedIds(db: SupabaseClient, userId: string, personIds: string[]): Promise<Set<string>> {
  if (!personIds.length) return new Set();
  const { data } = await db.from("saved_contacts").select("person_id").eq("owner_user_id", userId).in("person_id", personIds);
  return new Set((data ?? []).map((row) => row.person_id as string));
}

/** A short relationship cue per person: the first group they belong to (e.g. an advisory board). */
export async function groupCues(db: SupabaseClient, personIds: string[]): Promise<Map<string, string>> {
  if (!personIds.length) return new Map();
  const { data } = await db
    .from("group_memberships")
    .select("person_id, groups(name)")
    .in("person_id", personIds)
    .returns<{ person_id: string; groups: { name: string } | null }[]>();
  const cues = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.groups && !cues.has(row.person_id)) cues.set(row.person_id, row.groups.name);
  }
  return cues;
}

/** Each person's LinkedIn profile URL, where they have one. */
export async function linkedinUrls(db: SupabaseClient, personIds: string[]): Promise<Map<string, string>> {
  if (!personIds.length) return new Map();
  const { data } = await db.from("contact_points").select("person_id, value").eq("kind", "linkedin").in("person_id", personIds);
  return new Map((data ?? []).map((row) => [row.person_id as string, row.value as string]));
}
