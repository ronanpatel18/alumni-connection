"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { MAX_LENGTHS, sanitizeString, uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Mid-morning in Wisconsin, so the date reads the same across US time zones.
const atMorning = (date: string) => `${date}T15:00:00Z`;

const schema = z.object({
  person_id: z.string().uuid("Choose who this is about."),
  kind: z.enum(["meeting", "call", "email", "intro", "event", "other"]),
  occurred_on: z.union([z.literal(""), day]),
  summary: z.string().max(MAX_LENGTHS.note).transform(sanitizeString),
  follow_up_on: z.union([z.literal(""), day]),
});

/** Logs a conversation with someone and, optionally, a date to follow up. Private to the member. */
export async function logInteraction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireMember("/followups");
  const parsed = schema.safeParse({
    person_id: formData.get("person_id") ?? "",
    kind: formData.get("kind") ?? "other",
    occurred_on: formData.get("occurred_on") ?? "",
    summary: formData.get("summary") ?? "",
    follow_up_on: formData.get("follow_up_on") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const { person_id, kind, occurred_on, summary, follow_up_on } = parsed.data;
  if (!summary && !follow_up_on) return { status: "error", message: "Add a note about what happened, a date to follow up, or both." };

  const supabase = await createClient();
  const { error } = await supabase.from("interactions").insert({
    owner_user_id: viewer.userId,
    person_id,
    kind,
    occurred_at: occurred_on ? atMorning(occurred_on) : null,
    summary: summary || null,
    follow_up_at: follow_up_on ? atMorning(follow_up_on) : null,
  });
  if (error) return { status: "error", message: "That couldn’t be saved. Try again." };
  revalidatePath("/followups");
  redirect(`/followups?result=${follow_up_on ? "reminder" : "logged"}`);
}

/** Marks a follow-up done, or reopens it. */
export async function setFollowUpDone(formData: FormData) {
  await requireMember("/followups");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase
    .from("interactions")
    .update({ follow_up_done_at: formData.get("done") === "true" ? new Date().toISOString() : null })
    .eq("id", id.data);
  revalidatePath("/followups");
}

export async function deleteInteraction(formData: FormData) {
  await requireMember("/followups");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.from("interactions").delete().eq("id", id.data);
  revalidatePath("/followups");
  redirect("/followups?result=deleted");
}
