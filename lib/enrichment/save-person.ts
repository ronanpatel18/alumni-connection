// Creates a profile from a name and saves what lookupPerson() found for it.
// Takes the database client as an argument (a service-role client), so the
// admin page, the background job and the script all share it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ai } from "@/lib/ai";
import { nameKey } from "@/lib/importers/roster";
import { seniorityFor } from "@/lib/importers/wsb-boards";
import { lookupPerson, type PersonFindings, sameOrg, SIDE_ROLE } from "./person-lookup";

/** enrichment_jobs.provider for these lookups, so the admin page can list them. */
export const LOOKUP_PROVIDER = "web-lookup";

const STATUS_RANK: Record<string, number> = { unknown: 0, not_alumnus: 1, likely: 2, source_stated: 3, confirmed: 4 };
const CITY_ALIASES: Record<string, string> = { nyc: "New York", "new york city": "New York", la: "Los Angeles", sf: "San Francisco", dc: "Washington", "washington dc": "Washington", "washington, d.c.": "Washington" };
const cityKey = (name: string) => name.toLowerCase().replace(/\s+city$/, "").replace(/^saint\b/, "st.");
const degreeKey = (degree: string | null) => (degree ?? "").replace(/\./g, "").toUpperCase();

/** Tidies a typed name: "  jane   DOE " → "Jane Doe"; names typed with their own capitals are left alone. */
export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

/** A person's name: two or more words of letters, nothing that looks like a sentence, link or address. */
export function looksLikeName(name: string): boolean {
  return /^[\p{L}][\p{L}.'’\-]*(\s+[\p{L}][\p{L}.'’\-]*){1,5}$/u.test(name) && name.length <= 80;
}

export type AddResult =
  | { status: "added"; name: string; personId: string; jobId: string }
  | { status: "duplicate"; name: string; personId: string; existingName: string }
  | { status: "removed"; name: string }
  | { status: "invalid"; name: string };

/**
 * Adds one seeded profile per new name and queues its lookup. Skips names that
 * aren't names, people already in the directory, and anyone who asked to be
 * removed (the suppression list is checked before any profile is created).
 */
export async function addPeopleByName(db: SupabaseClient, rawNames: string[], actorUserId: string | null): Promise<AddResult[]> {
  const { data: institution, error: institutionError } = await db.from("institutions").select("id").eq("slug", "uw-madison").single<{ id: string }>();
  if (institutionError) throw institutionError;
  const [existing, suppressed] = await Promise.all([all<{ id: string; full_name: string }>(db, "people", "id, full_name"), all<{ full_name: string }>(db, "suppression_list", "full_name")]);
  const byName = new Map(existing.map((p) => [nameKey(p.full_name), p]));
  const removed = new Set(suppressed.map((s) => nameKey(s.full_name)));

  const results: AddResult[] = [];
  for (const raw of rawNames) {
    const name = cleanName(raw);
    const key = nameKey(name);
    if (!looksLikeName(name) || !key.includes(" ")) {
      results.push({ status: "invalid", name });
      continue;
    }
    if (removed.has(key)) {
      results.push({ status: "removed", name });
      continue;
    }
    const match = byName.get(key);
    if (match) {
      results.push({ status: "duplicate", name, personId: match.id, existingName: match.full_name });
      continue;
    }
    const words = name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w));
    const { data: person, error } = await db
      .from("people")
      .insert({ institution_id: institution.id, full_name: name, first_name: words[0], last_name: words[words.length - 1], status: "seeded" })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    const { data: job, error: jobError } = await db
      .from("enrichment_jobs")
      .insert({ person_id: person.id, kind: "full", status: "queued", provider: LOOKUP_PROVIDER })
      .select("id")
      .single<{ id: string }>();
    if (jobError) throw jobError;
    await db.from("field_provenance").upsert({ person_id: person.id, field: "full_name", source: "admin", confidence: 1 }, { onConflict: "person_id,field,source" });
    await db.from("audit_log").insert({ actor_user_id: actorUserId, action: "admin_add_person", target_table: "people", target_id: person.id, metadata: { full_name: name } });
    byName.set(key, { id: person.id, full_name: name });
    results.push({ status: "added", name, personId: person.id, jobId: job.id });
  }
  return results;
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

interface PersonRow {
  id: string;
  full_name: string;
  status: string;
  institution_id: string;
  current_title: string | null;
  current_organization_id: string | null;
  industry_id: number | null;
  place_id: number | null;
  city: string | null;
  alumni_status: string;
  specialties: string[];
  organizations: { name: string } | null;
  positions: { id: string; title: string; organization_name: string; is_current: boolean; start_date: string | null }[];
  educations: { id: string; degree: string | null; major: string | null; grad_year: number | null; verified_by: string | null }[];
  contact_points: { kind: string; value: string }[];
  field_provenance: { field: string; source: string }[];
}

async function findOrCreateOrganization(db: SupabaseClient, name: string): Promise<string> {
  const { data: found } = await db.from("organizations").select("id").ilike("name", name.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle<{ id: string }>();
  if (found) return found.id;
  const { data, error } = await db.from("organizations").insert({ name }).select("id").single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

/**
 * Writes findings onto an unclaimed profile. It only fills gaps: anything a
 * member or an administrator set stays, and a claimed profile isn't touched.
 * Returns what changed, in plain words.
 */
export async function savePersonFindings(db: SupabaseClient, personId: string, findings: PersonFindings): Promise<string[]> {
  const { data: person, error } = await db
    .from("people")
    .select(
      "id, full_name, status, institution_id, current_title, current_organization_id, industry_id, place_id, city, alumni_status, specialties, " +
        "organizations:current_organization_id(name), positions(id, title, organization_name, is_current, start_date), " +
        "educations(id, degree, major, grad_year, verified_by), contact_points(kind, value), field_provenance(field, source)",
    )
    .eq("id", personId)
    .single<PersonRow>();
  if (error) throw error;
  if (person.status !== "seeded") return [];

  const locked = new Set(person.field_provenance.filter((f) => f.source === "admin" || f.source === "self").map((f) => f.field));
  const changes: string[] = [];
  const provenance: { field: string; sourceUrl: string | null; confidence: number }[] = [];
  const update: Record<string, unknown> = {};

  // Degrees and class years.
  if (!locked.has("educations")) {
    for (const found of findings.educations) {
      const same = person.educations.find((e) => (degreeKey(e.degree) === degreeKey(found.degree) || !e.degree || !found.degree) && (!e.grad_year || !found.gradYear || e.grad_year === found.gradYear));
      const label = [found.degree ?? "UW–Madison degree", found.gradYear && `’${String(found.gradYear).slice(2)}`].filter(Boolean).join(" ");
      if (!same) {
        const school = /BBA|MBA|MAcc/i.test(found.degree ?? "") || /business/i.test(found.major ?? "") ? "Wisconsin School of Business" : null;
        const { data: row, error: insertError } = await db
          .from("educations")
          .insert({ person_id: personId, institution_id: person.institution_id, school, degree: found.degree, major: found.major, grad_year: found.gradYear, verified_by: "source" })
          .select("id")
          .single<{ id: string }>();
        if (insertError) throw insertError;
        person.educations.push({ id: row.id, degree: found.degree, major: found.major, grad_year: found.gradYear, verified_by: "source" });
        changes.push(`Education: ${label}`);
        provenance.push({ field: "educations", sourceUrl: found.sourceUrl, confidence: 0.85 });
      } else if (same.verified_by === "source" || same.verified_by === null) {
        const fill = { degree: same.degree ?? found.degree, major: same.major ?? found.major, grad_year: same.grad_year ?? found.gradYear };
        if (fill.degree !== same.degree || fill.major !== same.major || fill.grad_year !== same.grad_year) {
          await db.from("educations").update(fill).eq("id", same.id);
          Object.assign(same, fill);
          changes.push(`Education: ${label}`);
          provenance.push({ field: "educations", sourceUrl: found.sourceUrl, confidence: 0.85 });
        }
      }
    }
  }
  if (STATUS_RANK[findings.alumniStatus] > STATUS_RANK[person.alumni_status] && !locked.has("alumni_status")) {
    update.alumni_status = findings.alumniStatus;
    provenance.push({ field: "alumni_status", sourceUrl: findings.alumniSourceUrl, confidence: 0.85 });
  }

  // Work history, then the current role when the profile has none.
  const newPositions = locked.has("positions")
    ? []
    : findings.positions.filter(
        (f) => f.organization.toLowerCase() !== person.full_name.toLowerCase() && !person.positions.some((p) => p.title.toLowerCase() === f.title.toLowerCase() && sameOrg(p.organization_name, f.organization)),
      );
  const main = findings.positions.find((p) => p.isCurrent && !SIDE_ROLE.test(p.title)) ?? findings.positions.find((p) => p.isCurrent);
  const setRole = Boolean(main) && !person.current_title && !person.current_organization_id && !locked.has("current_title") && !locked.has("current_organization_id");
  let mainOrganizationId: string | null = null;
  if (main && setRole) mainOrganizationId = await findOrCreateOrganization(db, main.organization);
  if (newPositions.length) {
    const { error: insertError } = await db.from("positions").insert(
      newPositions.map((p) => ({
        person_id: personId,
        organization_id: p === main ? mainOrganizationId : null,
        organization_name: p.organization,
        title: p.title,
        seniority: seniorityFor(p.title),
        start_date: p.startDate,
        end_date: p.endDate,
        is_current: p.isCurrent,
      })),
    );
    if (insertError) throw insertError;
    changes.push(`${newPositions.length} ${newPositions.length === 1 ? "job" : "jobs"}: ${newPositions.map((p) => `${p.title} at ${p.organization}`).join("; ")}`);
    provenance.push({ field: "positions", sourceUrl: newPositions[0].sourceUrl, confidence: 0.75 });
  }
  if (main && setRole) {
    Object.assign(update, { current_title: main.title, current_organization_id: mainOrganizationId, headline: `${main.title} at ${main.organization}`, seniority: seniorityFor(main.title) });
    changes.push(`Current role: ${main.title} at ${main.organization}`);
    provenance.push({ field: "current_title", sourceUrl: main.sourceUrl, confidence: 0.75 }, { field: "current_organization_id", sourceUrl: main.sourceUrl, confidence: 0.75 });
  }

  // Location: a listed city when we have it, else the words as found.
  if (findings.location && !person.place_id && !person.city && !locked.has("location")) {
    const city = CITY_ALIASES[findings.location.city.toLowerCase()] ?? findings.location.city;
    const state = findings.location.state;
    const { data: places } = await db.from("places").select("id, name, state").ilike("name", `${city.replace(/[%_\\]/g, "\\$&").replace(/^saint\b/i, "s%")}%`).returns<{ id: number; name: string; state: string }[]>();
    const place = (places ?? []).find((p) => cityKey(p.name) === cityKey(city) && (!state || p.state === state));
    Object.assign(update, place ? { place_id: place.id } : { city, state });
    changes.push(`Location: ${city}${state ? `, ${state}` : ""}`);
    provenance.push({ field: "location", sourceUrl: findings.location.sourceUrl, confidence: 0.8 });
  }

  if (findings.industrySlug && !person.industry_id) {
    const { data: industry } = await db.from("industries").select("id").eq("slug", findings.industrySlug).maybeSingle<{ id: number }>();
    if (industry) {
      update.industry_id = industry.id;
      provenance.push({ field: "industry_id", sourceUrl: findings.sources[0]?.url ?? null, confidence: 0.7 });
    }
  }
  if (findings.specialties.length && !person.specialties.length) update.specialties = findings.specialties;

  if (Object.keys(update).length) {
    const { error: updateError } = await db.from("people").update(update).eq("id", personId);
    if (updateError) throw updateError;
  }

  if (findings.linkedinUrl && !person.contact_points.some((c) => c.kind === "linkedin")) {
    await db
      .from("contact_points")
      .upsert({ person_id: personId, kind: "linkedin", value: findings.linkedinUrl, label: "work", source: "web", visibility: "members" }, { onConflict: "person_id,kind,value" });
    changes.push("LinkedIn profile");
    provenance.push({ field: "linkedin", sourceUrl: findings.linkedinUrl, confidence: 0.7 });
  }

  if (provenance.length) {
    const now = new Date().toISOString();
    await db.from("field_provenance").upsert(
      [...new Map(provenance.map((p) => [p.field, p])).values()].map((p) => ({ person_id: personId, field: p.field, source: "web", confidence: p.confidence, source_url: p.sourceUrl, fetched_at: now })),
      { onConflict: "person_id,field,source" },
    );
  }
  return changes;
}

export interface LookupOutcome {
  status: "succeeded" | "needs_review" | "failed";
  changes: string[];
  notes: string[];
}

/**
 * The whole job for one person: mark it running, search, save, record the
 * result on the enrichment_jobs row. Never throws: a failure is recorded on
 * the job, where the admin page shows it with a way to try again.
 */
export async function runPersonLookup(db: SupabaseClient, ai: Ai, { personId, jobId, hint }: { personId: string; jobId: string; hint?: string | null }): Promise<LookupOutcome> {
  const finish = async (outcome: LookupOutcome) => {
    const detail = [...outcome.notes, ...(outcome.changes.length ? [] : outcome.status === "failed" ? [] : ["Nothing new was found."])].join(" ").slice(0, 500) || null;
    await db.from("enrichment_jobs").update({ status: outcome.status, error: detail, finished_at: new Date().toISOString() }).eq("id", jobId);
    return outcome;
  };
  try {
    await db.from("enrichment_jobs").update({ status: "running", attempts: 1 }).eq("id", jobId);
    const [{ data: person, error }, { data: industries }] = await Promise.all([
      db
        .from("people")
        .select("full_name, current_title, organizations:current_organization_id(name), contact_points(kind, value)")
        .eq("id", personId)
        .single<{ full_name: string; current_title: string | null; organizations: { name: string } | null; contact_points: { kind: string; value: string }[] }>(),
      db.from("industries").select("slug, name").returns<{ slug: string; name: string }[]>(),
    ]);
    if (error) throw error;
    const findings = await lookupPerson(
      {
        fullName: person.full_name,
        hint,
        title: person.current_title,
        organizationName: person.organizations?.name ?? null,
        linkedinUrl: person.contact_points.find((c) => c.kind === "linkedin")?.value ?? null,
      },
      { ai, industries: industries ?? [] },
    );
    const changes = await savePersonFindings(db, personId, findings);
    const hasClassYear = findings.educations.some((e) => e.gradYear);
    return finish({ status: changes.length && hasClassYear && !findings.notes.length ? "succeeded" : "needs_review", changes, notes: findings.notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
    return finish({ status: "failed", changes: [], notes: [message] });
  }
}
