// Imports the rows of an institution-authorized roster that the preview marked
// "new". Takes a service-role client; the caller has checked the admin's role.
// Rows are re-checked against the directory and the removal list right before
// writing, so a stale preview can't add a duplicate or someone who opted out.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type DirectoryPerson, previewRoster, type RosterRow, type Suppression } from "./roster";
import { seniorityFor } from "./wsb-boards";

const CHUNK = 200;
const MAX_YEAR = new Date().getFullYear() + 6;

export interface RosterImportResult {
  imported: { id: string; name: string; missing: string[] }[];
  /** Rows that were new in the preview but aren't any more (added or removed since). */
  skipped: number;
}

async function all<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999).returns<T[]>();
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function insertAll(db: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const validEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
const validLinkedin = (url: string) => /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+/i.test(url);
const classYear = (raw: string) => {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1930 && year <= MAX_YEAR ? year : null;
};

export async function importRosterRows(db: SupabaseClient, rows: RosterRow[], actorUserId: string, sourceLabel: string): Promise<RosterImportResult> {
  const [{ data: institution, error }, people, suppressions, organizations, { data: places }] = await Promise.all([
    db.from("institutions").select("id").eq("slug", "uw-madison").single<{ id: string }>(),
    all<{ id: string; full_name: string; contact_points: { kind: string; value: string }[] }>(db, "people", "id, full_name, contact_points(kind, value)"),
    all<{ full_name: string; email_sha256: string | null }>(db, "suppression_list", "full_name, email_sha256"),
    all<{ id: string; name: string }>(db, "organizations", "id, name"),
    db.from("places").select("id, name, state").returns<{ id: number; name: string; state: string }[]>(),
  ]);
  if (error) throw error;

  const directory: DirectoryPerson[] = people.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    emails: p.contact_points.filter((c) => c.kind === "email").map((c) => c.value),
    linkedins: p.contact_points.filter((c) => c.kind === "linkedin").map((c) => c.value),
  }));
  const removed: Suppression[] = suppressions.map((s) => ({ fullName: s.full_name, emailSha256: s.email_sha256 }));
  const fresh = new Set(previewRoster(rows, directory, removed).rows.filter((r) => r.status === "new").map((r) => r.row));
  const toImport = rows.filter((r) => fresh.has(r.row));

  const orgIds = new Map(organizations.map((o) => [o.name.trim().toLowerCase(), o.id]));
  const newOrgs: Record<string, unknown>[] = [];
  const orgIdFor = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    let id = orgIds.get(key);
    if (!id) {
      id = randomUUID();
      orgIds.set(key, id);
      newOrgs.push({ id, name: name.trim() });
    }
    return id;
  };
  const placeFor = (city: string, state: string) =>
    (places ?? []).find((p) => p.name.toLowerCase() === city.trim().toLowerCase() && (!state || p.state === state.trim().toUpperCase()))?.id ?? null;

  const now = new Date().toISOString();
  const peopleRows: Record<string, unknown>[] = [];
  const educations: Record<string, unknown>[] = [];
  const positions: Record<string, unknown>[] = [];
  const contacts: Record<string, unknown>[] = [];
  const provenance: Record<string, unknown>[] = [];
  const imported: RosterImportResult["imported"] = [];

  for (const row of toImport) {
    const id = randomUUID();
    const name = row.name.replace(/\s+/g, " ").trim().slice(0, 120);
    const words = name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?,?$/i.test(w));
    const title = row.title.trim().slice(0, 150) || null;
    const employer = row.employer.trim().slice(0, 200) || null;
    const organizationId = employer ? orgIdFor(employer) : null;
    const placeId = row.city ? placeFor(row.city, row.state) : null;
    const state = /^[A-Za-z]{2}$/.test(row.state.trim()) ? row.state.trim().toUpperCase() : null;
    const year = classYear(row.classYear);
    const fields = ["full_name", "alumni_status"];

    peopleRows.push({
      id,
      institution_id: institution.id,
      full_name: name,
      first_name: words[0] ?? null,
      last_name: words.length > 1 ? words[words.length - 1] : null,
      current_title: title,
      current_organization_id: organizationId,
      headline: title && employer ? `${title} at ${employer}` : (title ?? employer),
      seniority: seniorityFor(title),
      place_id: placeId,
      ...(placeId ? {} : { city: row.city.trim().slice(0, 100) || null, state }),
      status: "seeded",
      // The institution's own roster is the strongest evidence of alumni status we get.
      alumni_status: "confirmed",
    });
    if (year) {
      educations.push({ person_id: id, institution_id: institution.id, grad_year: year, verified_by: "roster" });
      fields.push("educations");
    }
    if (title && employer) {
      positions.push({ person_id: id, organization_id: organizationId, organization_name: employer, title, seniority: seniorityFor(title), is_current: true });
      fields.push("current_title", "current_organization_id", "positions");
    }
    if (row.city) fields.push("location");
    // A roster email is for matching a claim, not for members to see.
    if (validEmail(row.email)) contacts.push({ person_id: id, kind: "email", value: row.email.trim().toLowerCase(), source: "roster", visibility: "private" });
    if (validLinkedin(row.linkedin)) {
      contacts.push({ person_id: id, kind: "linkedin", value: row.linkedin.trim().split(/[?#]/)[0], label: "work", source: "roster", visibility: "members" });
      fields.push("linkedin");
    }
    for (const field of fields) provenance.push({ person_id: id, field, source: "roster", confidence: 1, fetched_at: now });
    const missing = [!year && "class year", !(title && employer) && "role", !row.city && "location"].filter((m): m is string => Boolean(m));
    imported.push({ id, name, missing });
  }

  await insertAll(db, "organizations", newOrgs);
  await insertAll(db, "people", peopleRows);
  await insertAll(db, "educations", educations);
  await insertAll(db, "positions", positions);
  await insertAll(db, "contact_points", contacts);
  await insertAll(db, "field_provenance", provenance);
  if (imported.length) {
    await db.from("audit_log").insert({ actor_user_id: actorUserId, action: "admin_import_roster", target_table: "people", metadata: { source: sourceLabel.slice(0, 200), imported: imported.length } });
  }
  return { imported, skipped: rows.length - toImport.length };
}
