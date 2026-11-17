// Runs the contact pipeline against the database: who to search, the network
// access the sources get, and where findings are saved. Used by the admin page
// (/admin/contacts) and by `npm run contacts`.
//
// Confident, verified work details are stored as PRIVATE contact details;
// everything else waits in contact_findings for an administrator. Nothing is
// shown to members until an administrator approves it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPageText } from "@/lib/enrichment/free-sources";
import { webSearch } from "@/lib/enrichment/providers";
import { buildSuppression, findContactsFor, type PersonReport, type Suppression } from "./pipeline";
import { CONTACT_SOURCES } from "./sources";
import type { ContactSource, PersonRef, SourceContext } from "./types";

export interface ContactPersonRow {
  id: string;
  institution_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  current_title: string | null;
  city: string | null;
  state: string | null;
  organizations: { name: string; domain: string | null; website: string | null } | null;
  industries: { slug: string } | null;
  contact_points: { kind: string; value: string; source: string }[];
}

export const CONTACT_PERSON_COLUMNS =
  "id, institution_id, full_name, first_name, last_name, current_title, city, state, " +
  "organizations:current_organization_id(name, domain, website), industries:industry_id(slug), contact_points(kind, value, source)";

const domainOf = (org: ContactPersonRow["organizations"]) => {
  if (org?.domain) return org.domain.toLowerCase();
  try {
    return org?.website ? new URL(org.website).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md|cfa|cpa|esq)\.?$/i;

export function toPersonRef(row: ContactPersonRow): PersonRef {
  const parts = row.full_name.trim().split(/\s+/);
  const named = parts.filter((p) => !SUFFIX.test(p.replace(/,$/, "")));
  return {
    id: row.id,
    institutionId: row.institution_id,
    fullName: row.full_name,
    firstName: row.first_name ?? named[0] ?? parts[0],
    lastName: row.last_name ?? (named[named.length - 1] ?? parts[parts.length - 1]).replace(/,$/, ""),
    title: row.current_title,
    organizationName: row.organizations?.name ?? null,
    orgDomain: domainOf(row.organizations),
    industrySlug: row.industries?.slug ?? null,
    city: row.city,
    state: row.state,
    existing: row.contact_points,
  };
}

/** Real network access for the sources: web search, page reads and JSON APIs. */
export function networkContext(env: Record<string, string | undefined> = process.env): Omit<SourceContext, "note"> {
  return {
    env,
    search: async (text, options) =>
      (await webSearch(text, options)).flatMap((r) => (r.url ? [{ url: r.url, title: r.title ?? "", snippet: r.content ?? "" }] : [])),
    fetchPage: (url) => fetchPageText(url, { links: true }),
    async fetchJson(target, init) {
      const response = await fetch(target, { headers: { Accept: "application/json", ...init?.headers }, signal: AbortSignal.timeout(20_000) });
      // The URL can carry an API key, so errors name only the host.
      if (!response.ok) throw new Error(`${new URL(target).host} answered ${response.status}`);
      return response.json();
    },
  };
}

/** The sources that can run with this environment, in waterfall order. */
export const enabledSources = (env: Record<string, string | undefined> = process.env): ContactSource[] =>
  CONTACT_SOURCES.filter((source) => source.status(env).enabled);

export async function loadSuppression(db: SupabaseClient): Promise<Suppression> {
  const { data, error } = await db.from("suppression_list").select("full_name, email_sha256");
  if (error) throw error;
  return buildSuppression(data);
}

/** Saves one person's findings. Findings already decided (or already queued) are left exactly as they are. */
export async function saveReport(db: SupabaseClient, personId: string, report: PersonReport) {
  if (!report.findings.length) return;
  const now = new Date().toISOString();
  const { error: findingsError } = await db.from("contact_findings").upsert(
    report.findings.map((f) => ({
      person_id: personId,
      kind: f.kind,
      value: f.value,
      label: f.label,
      source: f.source,
      source_detail: f.sourceDetail,
      source_url: f.sourceUrl,
      evidence_quote: f.quote.slice(0, 600),
      confidence: f.confidence,
      verification: f.verification,
      pattern_guessed: f.patternGuessed,
      review_reasons: f.reviewReasons,
      status: f.status,
    })),
    { onConflict: "person_id,kind,value,source", ignoreDuplicates: true },
  );
  if (findingsError) throw findingsError;

  for (const f of report.findings.filter((x) => x.status === "stored")) {
    // Private until an administrator chooses to show it.
    const { error: pointError } = await db.from("contact_points").upsert(
      {
        person_id: personId,
        kind: f.kind,
        value: f.value,
        label: f.label,
        source: f.source,
        source_detail: f.sourceDetail,
        source_url: f.sourceUrl,
        verification: f.verification.status === "valid" ? "verifier" : "source_page",
        verified_at: f.verification.status === "valid" ? now : null,
        visibility: "private",
      },
      { onConflict: "person_id,kind,value", ignoreDuplicates: true },
    );
    if (pointError) throw pointError;
    const { error: provenanceError } = await db
      .from("field_provenance")
      .upsert(
        { person_id: personId, field: "contact_points", source: f.source, confidence: f.confidence, source_url: f.sourceUrl, fetched_at: now },
        { onConflict: "person_id,field,source" },
      );
    if (provenanceError) throw provenanceError;
  }
}

// A search takes well under a minute; one still open after this long was cut off.
export const SEARCH_STALLED_MS = 10 * 60_000;

export interface ContactProgress {
  /** Unclaimed profiles the pipeline may search. */
  total: number;
  searched: number;
  running: number;
  /** Not searched yet (or the search failed or was cut off), employer-known profiles first. */
  next: string[];
}

/** Where the directory stands: how many profiles have been searched and who is next. */
export async function contactProgress(db: SupabaseClient): Promise<ContactProgress> {
  const { data, error } = await db
    .from("people")
    .select("id, current_organization_id, contact_searches(status, started_at)")
    .is("claimed_by_user_id", null) // members manage their own details
    .neq("status", "opted_out")
    .order("full_name")
    .limit(5000)
    .returns<{ id: string; current_organization_id: string | null; contact_searches: { status: string; started_at: string } | { status: string; started_at: string }[] | null }[]>();
  if (error) throw error;
  const now = Date.now();
  let searched = 0;
  let running = 0;
  const next: { id: string; hasEmployer: boolean }[] = [];
  for (const row of data) {
    const search = Array.isArray(row.contact_searches) ? row.contact_searches[0] : row.contact_searches;
    if (search?.status === "done") searched++;
    else if (search?.status === "running" && now - Date.parse(search.started_at) < SEARCH_STALLED_MS) running++;
    else next.push({ id: row.id, hasEmployer: Boolean(row.current_organization_id) });
  }
  next.sort((a, b) => Number(b.hasEmployer) - Number(a.hasEmployer));
  return { total: data.length, searched, running, next: next.map((n) => n.id) };
}

/** Marks profiles as being searched, so the page shows progress and a second click doesn't repeat them. */
export async function markSearching(db: SupabaseClient, personIds: string[]) {
  if (!personIds.length) return;
  const { error } = await db
    .from("contact_searches")
    .upsert(personIds.map((id) => ({ person_id: id, status: "running", stored: 0, pending: 0, note: null, started_at: new Date().toISOString(), finished_at: null })));
  if (error) throw error;
}

const outcomeNote = (report: PersonReport) => {
  if (report.skipped) return `Skipped: ${report.skipped}`;
  const problems = report.notes.filter((n) => !n.startsWith("FEC:"));
  return (problems.length ? problems.join(" · ") : report.findings.length ? null : "Nothing found on public pages")?.slice(0, 500) ?? null;
};

// People searched side by side. Each asks several search providers, so this stays small.
const CONCURRENCY = 3;

/**
 * Searches for each person's work email and phone and saves what was found.
 * One person failing doesn't stop the rest; each outcome lands on their
 * contact_searches row.
 */
export async function runContactSearch(db: SupabaseClient, personIds: string[], env: Record<string, string | undefined> = process.env) {
  if (!personIds.length) return;
  const finish = (personId: string, values: { status: "done" | "failed"; stored?: number; pending?: number; note: string | null }) =>
    db.from("contact_searches").update({ ...values, finished_at: new Date().toISOString() }).eq("person_id", personId);
  try {
    const [{ data, error }, suppression] = await Promise.all([
      db.from("people").select(CONTACT_PERSON_COLUMNS).in("id", personIds).is("claimed_by_user_id", null).neq("status", "opted_out").returns<ContactPersonRow[]>(),
      loadSuppression(db),
    ]);
    if (error) throw error;
    const rows = new Map(data.map((row) => [row.id, row]));
    const sources = enabledSources(env);
    const ctx = networkContext(env);
    const queue = [...personIds];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const row = rows.get(id);
        if (!row) {
          await finish(id, { status: "done", note: "Skipped: the profile was claimed or removed" });
          continue;
        }
        try {
          const report = await findContactsFor(toPersonRef(row), sources, ctx, suppression);
          await saveReport(db, id, report);
          await finish(id, {
            status: "done",
            stored: report.findings.filter((f) => f.status === "stored").length,
            pending: report.findings.filter((f) => f.status === "pending").length,
            note: outcomeNote(report),
          });
        } catch (error) {
          await finish(id, { status: "failed", note: `The search didn’t finish: ${String((error as Error).message ?? error).slice(0, 300)}` });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (error) {
    // The batch couldn't start (database unreachable): free every row so it can be run again.
    await db
      .from("contact_searches")
      .update({ status: "failed", note: `The search didn’t start: ${String((error as Error).message ?? error).slice(0, 300)}`, finished_at: new Date().toISOString() })
      .in("person_id", personIds)
      .eq("status", "running");
  }
}
