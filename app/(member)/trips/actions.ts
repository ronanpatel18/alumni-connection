"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MAX_LENGTHS, sanitizeString } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

export interface TripValues {
  place_id: string;
  starts_on: string;
  ends_on: string;
  industry_slugs: string[];
  goal: string;
}

/** On an error, the submitted values come back so the form keeps what the member typed. */
export type TripFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: Record<string, string>; values?: TripValues; attempt: number };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const tripSchema = z
  .object({
    trip_id: z.union([z.literal(""), z.string().uuid()]),
    place_id: z.coerce.number().int().positive({ message: "Choose a destination city." }),
    starts_on: isoDate,
    ends_on: isoDate,
    industry_slugs: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1, "Choose at least one industry.").max(20),
    goal: z.string().max(1000).transform(sanitizeString).pipe(z.string().min(1, "Add a short goal for the trip.")),
  })
  .refine((t) => t.ends_on >= t.starts_on, { path: ["ends_on"], message: "Departure can’t be before arrival." });

/** Creates or updates a trip, then opens its shortlist. Private to the member. */
export async function saveTrip(_prev: TripFormState, formData: FormData): Promise<TripFormState> {
  const viewer = await requireMember("/trips");
  const values: TripValues = {
    place_id: String(formData.get("place_id") ?? ""),
    starts_on: String(formData.get("starts_on") ?? ""),
    ends_on: String(formData.get("ends_on") ?? ""),
    industry_slugs: formData.getAll("industry_slugs").map(String),
    goal: String(formData.get("goal") ?? ""),
  };
  const attempt = _prev.status === "error" ? _prev.attempt + 1 : 1;
  const parsed = tripSchema.safeParse({ trip_id: formData.get("trip_id") ?? "", ...values });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] ??= issue.message;
    return {
      status: "error",
      message: "Add arrival and departure dates in order, at least one industry, and a short goal.",
      fields,
      values,
      attempt,
    };
  }

  const { trip_id, ...trip } = parsed.data;
  const supabase = await createClient();
  let id = trip_id;
  if (trip_id) {
    const { error } = await supabase.from("trips").update(trip).eq("id", trip_id);
    if (error) return { status: "error", message: "The trip couldn’t be saved. Try again.", values, attempt };
  } else {
    const { data, error } = await supabase
      .from("trips")
      .insert({ ...trip, owner_user_id: viewer.userId })
      .select("id")
      .single();
    if (error || !data) return { status: "error", message: "The trip couldn’t be saved. Try again.", values, attempt };
    id = data.id as string;
  }
  revalidatePath("/trips");
  redirect(`/trips/${id}`);
}

export async function deleteTrip(formData: FormData) {
  await requireMember("/trips");
  const id = String(formData.get("trip_id") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect("/trips");
  const supabase = await createClient();
  await supabase.from("trips").delete().eq("id", id);
  revalidatePath("/trips");
  redirect("/trips?deleted=1");
}

/** Adds someone to a trip's private shortlist, or takes them off. Nobody is notified. */
export async function toggleShortlist(formData: FormData) {
  await requireMember("/trips");
  const tripId = String(formData.get("trip_id") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  if (!z.string().uuid().safeParse(tripId).success || !z.string().uuid().safeParse(personId).success) return;
  const supabase = await createClient();
  if (formData.get("selected") === "true") {
    await supabase.from("trip_shortlist").delete().eq("trip_id", tripId).eq("person_id", personId);
  } else {
    await supabase.from("trip_shortlist").upsert({ trip_id: tripId, person_id: personId }, { onConflict: "trip_id,person_id", ignoreDuplicates: true });
  }
  revalidatePath(`/trips/${tripId}`);
}

export type DraftState = { status: "idle" } | { status: "saved"; at: string } | { status: "error"; message: string };

const draftSchema = z.object({
  trip_id: z.union([z.literal(""), z.string().uuid()]),
  person_id: z.string().uuid(),
  subject: z.string().max(200).transform(sanitizeString).pipe(z.string().min(1, "Add a subject.")),
  body: z.string().max(MAX_LENGTHS.note).transform(sanitizeString).pipe(z.string().min(1, "Write a message.")),
});

/** Saves the member's edited message. Saving never sends anything. */
export async function saveDraft(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const viewer = await requireMember("/trips");
  const parsed = draftSchema.safeParse({
    trip_id: formData.get("trip_id") ?? "",
    person_id: formData.get("person_id") ?? "",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the message." };
  const { trip_id, person_id, subject, body } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("outreach_drafts").upsert(
    {
      owner_user_id: viewer.userId,
      person_id,
      trip_id: trip_id || null,
      subject,
      body,
      ai_drafted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_user_id,person_id,trip_id" },
  );
  if (error) return { status: "error", message: "The draft couldn’t be saved. Try again." };
  return { status: "saved", at: new Date().toISOString() };
}
