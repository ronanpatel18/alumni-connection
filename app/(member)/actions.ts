"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

/** Saving is private: it never notifies the person or implies a connection. */
export async function toggleSaved(formData: FormData) {
  const viewer = await requireMember();
  const personId = uuidSchema.parse(formData.get("personId"));
  const saved = formData.get("saved") === "true";
  const supabase = await createClient();

  if (saved) {
    await supabase.from("saved_contacts").delete().eq("owner_user_id", viewer.userId).eq("person_id", personId);
  } else {
    await supabase.from("saved_contacts").insert({ owner_user_id: viewer.userId, person_id: personId });
  }
  revalidatePath("/", "layout");
}
