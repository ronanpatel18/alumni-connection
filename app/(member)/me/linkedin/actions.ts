"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export type ImportState =
  | { status: "idle" }
  | {
      status: "done";
      addedPositions: number;
      datedPositions: number;
      addedDegrees: number;
      datedDegrees: number;
      matched: { id: string; name: string }[];
      checked: number;
    }
  | { status: "error"; message: string };

const short = (max: number) => z.string().max(max).transform((s) => s.trim());
const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-01$/)]).nullable();

const payloadSchema = z.object({
  history: z
    .object({
      positions: z.array(z.object({ title: short(200), company: short(200), start_date: date, end_date: date })).max(200),
      educations: z.array(z.object({ degree: short(80).nullable(), grad_year: z.number().int().min(1930).max(2100).nullable() })).max(10),
    })
    .nullable(),
  connections: z
    .array(z.object({ first: short(100), last: short(100), url: short(300).nullable(), company: short(200).nullable() }))
    .max(30_000)
    .nullable(),
});

/**
 * Imports what the member chose from their own LinkedIn export (already read in
 * their browser): their work history and UW degrees, and the people in their
 * connections who are in the directory. Unmatched connections aren't kept.
 */
export async function importLinkedIn(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const viewer = await requireMember("/me/linkedin");
  let parsed;
  try {
    parsed = payloadSchema.safeParse(JSON.parse(String(formData.get("payload") ?? "null")));
  } catch {
    return { status: "error", message: "The export couldn’t be read. Choose the file again." };
  }
  if (!parsed.success) return { status: "error", message: "Some of the export looks unusual. Download it again from LinkedIn and retry." };
  const { history, connections } = parsed.data;
  const supabase = await createClient();

  let counts = { added_positions: 0, dated_positions: 0, added_degrees: 0, dated_degrees: 0 };
  if (history && viewer.personId) {
    const { data, error } = await supabase.rpc("import_my_linkedin_history", { p: history });
    if (error) return { status: "error", message: "Your work history couldn’t be added. Try again." };
    counts = data as typeof counts;
  }

  let matched: { id: string; name: string }[] = [];
  if (connections) {
    const { data, error } = await supabase.rpc("match_linkedin_connections", { p_rows: connections });
    if (error) return { status: "error", message: "Your connections couldn’t be matched. Try again." };
    const rows = (data ?? []) as { person_id: string; matched_by: string }[];
    // A fresh import replaces the previous one.
    await supabase.from("my_connections").delete().eq("owner_user_id", viewer.userId);
    if (rows.length) {
      const { error: insertError } = await supabase
        .from("my_connections")
        .insert(rows.map((r) => ({ owner_user_id: viewer.userId, person_id: r.person_id, matched_by: r.matched_by })));
      if (insertError) return { status: "error", message: "Your connections couldn’t be saved. Try again." };
      const { data: people } = await supabase
        .from("people")
        .select("id, full_name")
        .in(
          "id",
          rows.map((r) => r.person_id),
        )
        .order("full_name");
      matched = (people ?? []).map((p) => ({ id: p.id as string, name: p.full_name as string }));
    }
  }

  revalidatePath("/me/linkedin");
  if (viewer.personId) revalidatePath(`/people/${viewer.personId}`);
  return {
    status: "done",
    addedPositions: counts.added_positions,
    datedPositions: counts.dated_positions,
    addedDegrees: counts.added_degrees,
    datedDegrees: counts.dated_degrees,
    matched,
    checked: connections?.length ?? 0,
  };
}

/** Deletes every imported connection. Profile edits stay (change them in Edit profile). */
export async function removeImportedConnections() {
  const viewer = await requireMember("/me/linkedin");
  const supabase = await createClient();
  await supabase.from("my_connections").delete().eq("owner_user_id", viewer.userId);
  revalidatePath("/me/linkedin");
}
