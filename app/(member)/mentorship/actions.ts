"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { deliverNotifications } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { sanitizeString, uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

/** Database messages written for the member (see request_mentorship); anything else gets a general one. */
const SHOWN = new Set(["P0002", "22023", "54000", "42501", "23505"]);

/** Asks a member who is open to mentoring. They accept or decline. */
export async function requestMentorship(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireMember("/mentorship");
  const mentor = uuidSchema.safeParse(formData.get("mentor_id"));
  const goal = sanitizeString(String(formData.get("goal") ?? "")).slice(0, 1000);
  if (!mentor.success) return { status: "error", message: "Choose a mentor." };
  if (!goal) return { status: "error", message: "Say what you’d like help with." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_mentorship", { p_mentor: mentor.data, p_goal: goal });
  if (error) return { status: "error", message: SHOWN.has(error.code) ? `${error.message}.` : "The request couldn’t be sent. Try again." };
  await deliverNotifications().catch(() => undefined);
  revalidatePath("/mentorship");
  redirect("/mentorship?result=asked");
}

export async function respondToMentorship(formData: FormData) {
  await requireMember("/mentorship");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/mentorship");
  const accept = formData.get("decision") === "accept";
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_mentorship", { p_mentorship: id.data, p_accept: accept });
  if (!error) await deliverNotifications().catch(() => undefined);
  revalidatePath("/mentorship");
  redirect(`/mentorship?result=${error ? "error" : accept ? "accepted" : "declined"}`);
}

export async function endMentorship(formData: FormData) {
  await requireMember("/mentorship");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/mentorship");
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_mentorship", { p_mentorship: id.data });
  revalidatePath("/mentorship");
  redirect(`/mentorship?result=${error ? "error" : "ended"}`);
}

/** Adds or removes "mentoring" from what the member's profile says they're open to. */
export async function setOpenToMentoring(formData: FormData) {
  const viewer = await requireMember("/mentorship");
  if (!viewer.personId) redirect("/mentorship");
  const open = formData.get("open") === "true";
  const supabase = await createClient();
  const { data: me } = await supabase.from("people").select("open_to").eq("id", viewer.personId).single<{ open_to: string[] }>();
  const current = (me?.open_to ?? []).filter((o) => o !== "mentoring");
  await supabase.from("people").update({ open_to: open ? [...current, "mentoring"] : current }).eq("id", viewer.personId);
  revalidatePath("/mentorship");
  revalidatePath(`/people/${viewer.personId}`);
  redirect(`/mentorship?result=${open ? "open" : "closed"}`);
}
