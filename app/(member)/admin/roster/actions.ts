"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { searchConfigured } from "@/lib/enrichment/providers";
import { queueLookups, startLookups } from "@/lib/enrichment/start-lookups";
import { type DirectoryPerson, MAX_ROSTER_ROWS, parseRoster, previewRoster, type RosterPreview, type RosterRow, type Suppression } from "@/lib/importers/roster";
import { importRosterRows } from "@/lib/importers/roster-import";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sanitizeString } from "@/lib/validation";
import { requireAdmin } from "@/lib/viewer";

const MAX_FILE_BYTES = 2_000_000;
const PAGE = 1000;

export type RosterState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; fileName: string; source: string; preview: RosterPreview; ignoredColumns: string[]; importable: RosterRow[] }
  | { status: "imported"; imported: number; skipped: number; lookedUp: number };

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

  const preview = previewRoster(parsed.rows, people.map(toDirectoryPerson), removed);
  const fresh = new Set(preview.rows.filter((r) => r.status === "new").map((r) => r.row));
  return {
    status: "preview",
    fileName: file.name,
    source,
    ignoredColumns: parsed.ignoredColumns,
    preview,
    importable: parsed.rows.filter((r) => fresh.has(r.row)),
  };
}

const text = (max: number) => z.string().max(max);
const rowsSchema = z
  .array(
    z.object({
      row: z.number().int().positive(),
      name: text(200),
      email: text(320),
      classYear: text(20),
      title: text(300),
      employer: text(300),
      city: text(200),
      state: text(100),
      linkedin: text(500),
      source: text(200),
    }),
  )
  .min(1)
  .max(MAX_ROSTER_ROWS);

// Lookups cost searches; a whole roster would drain a month's free allowance.
const MAX_LOOKUPS = 25;

/** Adds the previewed rows that are still new. Each is re-checked against the directory and the removal list first. */
export async function importRoster(_prev: RosterState, formData: FormData): Promise<RosterState> {
  const viewer = await requireAdmin("/admin/roster");
  revalidatePath("/admin/roster");
  if (formData.get("authorized") !== "on") return { status: "error", message: "Confirm the institution authorized this roster." };
  const source = sanitizeString(String(formData.get("source") ?? "")).slice(0, 200);
  let parsed;
  try {
    parsed = rowsSchema.safeParse(JSON.parse(String(formData.get("rows") ?? "")));
  } catch {
    parsed = null;
  }
  if (!parsed?.success || !source) return { status: "error", message: "The preview is out of date. Preview the file again, then import." };

  const rows: RosterRow[] = parsed.data.map((r) => ({ ...r, name: sanitizeString(r.name), title: sanitizeString(r.title), employer: sanitizeString(r.employer), city: sanitizeString(r.city) }));
  let result;
  try {
    result = await importRosterRows(createAdminClient(), rows, viewer.userId, source);
  } catch {
    return { status: "error", message: "The import stopped part-way. Preview the file again to see what is still new, then import the rest." };
  }
  let lookedUp = 0;
  if (formData.get("lookup") === "on" && searchConfigured()) {
    const gaps = result.imported.filter((p) => p.missing.length).slice(0, MAX_LOOKUPS);
    await startLookups(await queueLookups(gaps.map((p) => p.id)), null);
    lookedUp = gaps.length;
  }
  revalidatePath("/admin/people");
  revalidatePath("/admin/review");
  return { status: "imported", imported: result.imported.length, skipped: result.skipped, lookedUp };
}
