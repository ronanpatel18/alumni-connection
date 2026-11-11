"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { linkSchema, sanitizeString, uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

const text = (max: number) => z.string().max(max).transform(sanitizeString);
const schema = z.object({
  title: text(200).pipe(z.string().min(1, "Give the event a name.")),
  description: text(4000),
  starts_at: z.string().datetime({ message: "Choose when it starts." }),
  ends_at: z.union([z.literal(""), z.string().datetime()]),
  place_id: z.union([z.literal(""), z.coerce.number().int().positive()]),
  city: text(100),
  state: z.string().trim().toUpperCase().refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Use a two-letter state, such as WI."),
  venue: text(300),
  url: linkSchema,
  is_online: z.boolean(),
});

/** Posts an event for members. The host can cancel it later; an administrator can too. */
export async function createEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireMember("/events");
  const parsed = schema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    starts_at: formData.get("starts_at_iso") ?? "",
    ends_at: formData.get("ends_at_iso") ?? "",
    place_id: formData.get("place_id") ?? "",
    city: formData.get("city") ?? "",
    state: formData.get("state") ?? "",
    venue: formData.get("venue") ?? "",
    url: formData.get("url") ?? "",
    is_online: formData.get("is_online") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const e = parsed.data;
  if (Date.parse(e.starts_at) < Date.now()) return { status: "error", message: "Choose a start time in the future." };
  if (e.ends_at && e.ends_at < e.starts_at) return { status: "error", message: "The end can’t be before the start." };
  if (!e.is_online && !e.place_id && !e.city) return { status: "error", message: "Choose a city, or mark the event as online." };

  const supabase = await createClient();
  const { data: institution } = await supabase.from("institutions").select("id").eq("slug", "uw-madison").single<{ id: string }>();
  const { error } = await supabase.from("events").insert({
    institution_id: institution?.id,
    created_by: viewer.userId,
    title: e.title,
    description: e.description || null,
    starts_at: e.starts_at,
    ends_at: e.ends_at || null,
    place_id: e.place_id || null,
    city: e.place_id ? null : e.city || null,
    state: e.place_id ? null : e.state || null,
    venue: e.venue || null,
    url: e.url || null,
    is_online: e.is_online,
  });
  if (error) return { status: "error", message: "The event couldn’t be posted. Try again." };
  revalidatePath("/events");
  redirect("/events?result=posted");
}

/** "I'm going", or takes it back. Other members can see who is going. */
export async function toggleRsvp(formData: FormData) {
  const viewer = await requireMember("/events");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  if (formData.get("going") === "true") await supabase.from("event_rsvps").delete().eq("event_id", id.data).eq("user_id", viewer.userId);
  else await supabase.from("event_rsvps").upsert({ event_id: id.data, user_id: viewer.userId }, { onConflict: "event_id,user_id", ignoreDuplicates: true });
  revalidatePath("/events");
}

/** The host (or an administrator) calls an event off. It stays listed as cancelled so people who planned to go see it. */
export async function cancelEvent(formData: FormData) {
  await requireMember("/events");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/events");
  const supabase = await createClient();
  const { data } = await supabase.from("events").update({ cancelled_at: new Date().toISOString() }).eq("id", id.data).select("id");
  revalidatePath("/events");
  redirect(`/events?result=${data?.length ? "cancelled" : "error"}`);
}
