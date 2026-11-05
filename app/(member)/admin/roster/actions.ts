"use server";

import { revalidatePath } from "next/cache";
import { type DirectoryPerson, parseRoster, previewRoster, type RosterPreview, type Suppression } from "@/lib/importers/roster";
import { createClient } from "@/lib/supabase/server";
import { sanitizeString } from "@/lib/validation";
import { requireAdmin } from "@/lib/viewer";

const MAX_FILE_BYTES = 2_000_000;
const PAGE = 1000;

export type RosterState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; fileName: string; preview: RosterPreview; ignoredColumns: string[] };

interface PersonRow {
  id: string;
  full_name: string;
  contact_points: { kind: string; value: string }[];
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** Every row, page by page: anyone missed past the API's page size would look like a new person. */
async function allRows<T>(db: Db, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + PAGE - 1)
      .returns<T[]>();
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

function toDirectoryPerson(p: PersonRow): DirectoryPerson {
  const values = (kind: string) => p.contact_points.filter((c) => c.kind === kind).map((c) => c.value);
  return { id: p.id, fullName: p.full_name, emails: values("email"), linkedins: values("linkedin") };
}

/** Compares a roster with the directory. Reads only: nothing is imported, and the file isn't kept. */
export async function previewRosterFile(_prev: RosterState, formData: FormData): Promise<RosterState> {
  await requireAdmin("/admin/roster");
  // Without this, a submit that beats hydration (a plain form POST) renders the
  // page while still in the action phase, which crashes cookies() in `next dev`.
  revalidatePath("/admin/roster");
  const source = sanitizeString(String(formData.get("source") ?? "")).slice(0, 200);
  const file = formData.get("file");
  if (!source) return { status: "error", message: "Say where this roster came from." };
  if (formData.get("authorized") !== "on") return { status: "error", message: "Confirm the institution authorized this roster." };
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a CSV file." };
  if (file.size > MAX_FILE_BYTES) return { status: "error", message: "That file is over 2 MB. Split it and preview each part." };

  const parsed = parseRoster(await file.text(), source);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const supabase = await createClient();
  const [people, suppressions] = await Promise.all([
    allRows<PersonRow>(supabase, "people", "id, full_name, contact_points(kind, value)"),
    allRows<{ full_name: string; email_sha256: string | null }>(supabase, "suppression_list", "full_name, email_sha256"),
  ]);
  const removed: Suppression[] = suppressions.map((s) => ({ fullName: s.full_name, emailSha256: s.email_sha256 }));

  return {
    status: "preview",
    fileName: file.name,
    ignoredColumns: parsed.ignoredColumns,
    preview: previewRoster(parsed.rows, people.map(toDirectoryPerson), removed),
  };
}
