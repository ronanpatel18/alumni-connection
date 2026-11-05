"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deliverNotifications } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { sanitizeString } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

export type RequestState = { status: "idle" } | { status: "error"; message: string; values?: { connector: string; goal: string }; attempt: number };

const requestSchema = z.object({
  target: z.string().uuid(),
  connector: z.string().uuid({ message: "Choose who you’d like to ask." }),
  goal: z
    .string()
    .max(1000)
    .transform(sanitizeString)
    .pipe(z.string().min(20, "Add a little more context so your connector can make an informed decision.")),
});

/** Asks a member to introduce you. Only the connector is told; the recipient isn't asked unless they agree. */
export async function requestIntro(prev: RequestState, formData: FormData): Promise<RequestState> {
  await requireMember("/introductions");
  const values = { connector: String(formData.get("connector") ?? ""), goal: String(formData.get("goal") ?? "") };
  const attempt = prev.status === "error" ? prev.attempt + 1 : 1;
  const parsed = requestSchema.safeParse({ target: formData.get("target"), ...values });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the request.", values, attempt };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_intro", {
    p_target: parsed.data.target,
    p_connector: parsed.data.connector,
    p_goal: parsed.data.goal,
    p_message: null,
  });
  if (error) {
    const known = ["23505", "22023", "42501"].includes(error.code ?? "");
    return { status: "error", message: known ? error.message : "The request couldn’t be sent. Try again.", values, attempt };
  }
  await deliverNotifications(); // emails the connector
  revalidatePath("/introductions");
  redirect(`/introductions/${data as string}?sent=1`);
}

const decisionSchema = z.object({ intro_id: z.string().uuid(), choice: z.enum(["yes", "no"]) });

/** The connector's or the recipient's own decision; the database checks which they are. */
export async function decideIntro(formData: FormData) {
  await requireMember("/introductions");
  const parsed = decisionSchema.safeParse({ intro_id: formData.get("intro_id"), choice: formData.get("choice") });
  if (!parsed.success) redirect("/introductions");
  const role = formData.get("role") === "connector" ? "connector" : "recipient";
  const supabase = await createClient();
  await supabase.rpc(role === "connector" ? "decide_intro_as_connector" : "decide_intro_as_recipient", {
    p_intro: parsed.data.intro_id,
    ...(role === "connector" ? { p_agree: parsed.data.choice === "yes" } : { p_accept: parsed.data.choice === "yes" }),
  });
  await deliverNotifications(); // emails whoever is next, and the requester about the outcome
  revalidatePath("/introductions");
  redirect(`/introductions/${parsed.data.intro_id}?decided=1`);
}

/** Either person introduced can record that they met; the database checks who's asking. */
export async function recordMeeting(formData: FormData) {
  await requireMember("/introductions");
  const id = String(formData.get("intro_id") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect("/introductions");
  const supabase = await createClient();
  await supabase.rpc("record_intro_meeting", { p_intro: id });
  revalidatePath(`/introductions/${id}`);
  redirect(`/introductions/${id}`);
}

export async function cancelIntro(formData: FormData) {
  await requireMember("/introductions");
  const id = String(formData.get("intro_id") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect("/introductions");
  const supabase = await createClient();
  await supabase.rpc("cancel_intro", { p_intro: id });
  revalidatePath("/introductions");
  redirect(`/introductions/${id}`);
}
