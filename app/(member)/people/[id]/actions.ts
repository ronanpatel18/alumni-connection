"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MAX_LENGTHS, sanitizeString, uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

const noteSchema = z.object({
  personId: uuidSchema,
  body: z.string().min(1).max(MAX_LENGTHS.note).transform(sanitizeString),
});

/** Private notes are visible only to their author (enforced by RLS). */
export async function addNote(formData: FormData) {
  const viewer = await requireMember();
  const parsed = noteSchema.safeParse({ personId: formData.get("personId"), body: formData.get("body") });
  if (!parsed.success || !parsed.data.body) return;
  const supabase = await createClient();
  await supabase.from("notes").insert({ owner_user_id: viewer.userId, person_id: parsed.data.personId, body: parsed.data.body });
  revalidatePath(`/people/${parsed.data.personId}`);
}
