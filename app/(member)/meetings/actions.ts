"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { deliverNotifications } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { sanitizeString, uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

const schema = z.object({
  person_id: z.string().uuid(),
  trip_id: z.union([z.literal(""), z.string().uuid()]),
  title: z.string().max(200).transform(sanitizeString).pipe(z.string().min(1, "Say what the meeting is for.")),
  starts_at: z.string().datetime({ message: "Choose a date and time." }),
  duration: z.coerce.number().int().min(15).max(480),
  location: z.string().max(300).transform(sanitizeString),
  note: z.string().max(2000).transform(sanitizeString),
});

/** Database messages written for the member (see propose_meeting); anything else gets a general one. */
const SHOWN = new Set(["P0002", "22023", "54000", "42501"]);

/** Invites another member to meet at a time. They accept or decline; nothing is booked until they accept. */
export async function proposeMeeting(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireMember("/meetings");
  const parsed = schema.safeParse({
    person_id: formData.get("person_id") ?? "",
    trip_id: formData.get("trip_id") ?? "",
    title: formData.get("title") ?? "",
    starts_at: formData.get("starts_at_iso") ?? "",
    duration: formData.get("duration") ?? 30,
    location: formData.get("location") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const m = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("propose_meeting", {
    p_person: m.person_id,
    p_title: m.title,
    p_starts_at: m.starts_at,
    p_duration: m.duration,
    p_location: m.location || null,
    p_note: m.note || null,
    p_trip: m.trip_id || null,
  });
  if (error) return { status: "error", message: SHOWN.has(error.code) ? `${error.message}.` : "The invitation couldn’t be sent. Try again." };
  await deliverNotifications().catch(() => undefined);
  revalidatePath("/meetings");
  redirect("/meetings?result=proposed");
}

export async function respondToMeeting(formData: FormData) {
  await requireMember("/meetings");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/meetings");
  const accept = formData.get("decision") === "accept";
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_meeting", { p_meeting: id.data, p_accept: accept });
  if (!error) await deliverNotifications().catch(() => undefined);
  revalidatePath("/meetings");
  redirect(`/meetings?result=${error ? "error" : accept ? "accepted" : "declined"}`);
}

export async function cancelMeeting(formData: FormData) {
  await requireMember("/meetings");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/meetings");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_meeting", { p_meeting: id.data });
  if (!error) await deliverNotifications().catch(() => undefined);
  revalidatePath("/meetings");
  redirect(`/meetings?result=${error ? "error" : "cancelled"}`);
}

/** Creates the member's private calendar address, or replaces it so the old one stops working. */
export async function rotateCalendarFeed() {
  await requireMember("/meetings");
  const supabase = await createClient();
  await supabase.rpc("rotate_calendar_feed");
  revalidatePath("/meetings");
  redirect("/meetings?result=feed");
}
