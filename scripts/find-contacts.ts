// Finds work emails and phone numbers for unclaimed profiles.
//
// Order of work for each person (docs/ARCHITECTURE.md §3, §3b, §7):
//   1. the suppression list: anyone who asked to be removed is skipped outright;
//   2. sources, free public listings first, then licensed APIs whose key is set;
//   3. proof: a value is kept only if its quote is on the source page (or it
//      came from a licensed API), and it passes a validity check;
//   4. confident work details are stored as PRIVATE contact details; everything
//      else waits in /admin/contacts. Nothing is shown to members until
//      an administrator approves it there.
// No AI model is used: values are read with patterns, never generated.
//
// Usage: npm run contacts -- [--write] [--names "A,B"] [--group slug] [--limit N] [--sources "id,id"]
//   Without --write it only reports what it would save.
import { createClient } from "@supabase/supabase-js";
import { formatUsPhone } from "@/lib/enrichment/contacts/extract";
import { buildSuppression, findContactsFor, type PersonReport } from "@/lib/enrichment/contacts/pipeline";
import { CONTACT_SOURCES } from "@/lib/enrichment/contacts/sources";
import type { PersonRef, SourceContext } from "@/lib/enrichment/contacts/types";
import { configuredVerifier } from "@/lib/enrichment/contacts/validate";
import { fetchPageText } from "@/lib/enrichment/free-sources";
import { searchConfigured, webSearch } from "@/lib/enrichment/search";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
const write = process.argv.includes("--write");
const names = list(arg("--names"));
const only = list(arg("--sources"));
const group = arg("--group");
const limit = Number(arg("--limit") ?? Infinity);

interface Row {
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

const domainOf = (org: Row["organizations"]) => {
  if (org?.domain) return org.domain.toLowerCase();
  try {
    return org?.website ? new URL(org.website).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

function toPerson(row: Row): PersonRef {
  const parts = row.full_name.trim().split(/\s+/);
  return {
    id: row.id,
    institutionId: row.institution_id,
    fullName: row.full_name,
    firstName: row.first_name ?? parts[0],
    lastName: row.last_name ?? parts[parts.length - 1],
    title: row.current_title,
    organizationName: row.organizations?.name ?? null,
    orgDomain: domainOf(row.organizations),
    industrySlug: row.industries?.slug ?? null,
    city: row.city,
    state: row.state,
    existing: row.contact_points,
  };
}

const show = (kind: string, value: string) => (kind === "phone" ? formatUsPhone(value) : value);

function print(report: PersonReport) {
  const { person } = report;
  console.log(`\n${person.fullName} — ${[person.title, person.organizationName].filter(Boolean).join(", ") || "no role on file"}`);
  if (report.skipped) return console.log(`  skipped: ${report.skipped}`);
  for (const f of report.findings) {
    const fate = f.status === "stored" ? "store privately" : `review (${f.reviewReasons.join(", ")})`;
    console.log(`  ${f.kind} ${show(f.kind, f.value)}  [${f.label}, ${f.source}/${f.sourceDetail}, confidence ${f.confidence}, ${f.verification.status} via ${f.verification.method}] → ${fate}`);
    console.log(`      ${f.sourceUrl}`);
    console.log(`      “${f.quote.slice(0, 160)}”`);
  }
  for (const d of report.dropped) console.log(`  dropped ${d.kind} ${show(d.kind, d.value)} (${d.source}): ${d.why}`);
  for (const note of report.notes) console.log(`  note: ${note}`);
  if (!report.findings.length && !report.dropped.length) console.log("  nothing found");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  if (write && !local && !process.argv.includes("--confirm-remote")) {
    console.error(`Refusing to write to ${url || "(unset)"}. This isn't a local database; add --confirm-remote if you mean it.`);
    process.exit(1);
  }
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });

  const sources = CONTACT_SOURCES.filter((s) => !only || only.includes(s.id));
  console.log("Sources, in order:");
  const enabled = sources.filter((source) => {
    const status = source.status(process.env);
    console.log(`  ${status.enabled ? "on " : "off"}  ${source.id.padEnd(16)} ${source.tier.padEnd(5)} ${source.label}${status.reason ? ` — ${status.reason}` : ""}`);
    return status.enabled;
  });
  const verifier = configuredVerifier(process.env);
  console.log(`Email check: ${verifier ? verifier.name : "mail-domain lookup only (no verifier key set; pattern-built addresses can't be confirmed)"}`);
  console.log(`Phone check: ${process.env.TWILIO_ACCOUNT_SID ? "Twilio Lookup" : "format only (no Twilio key set)"}`);
  if (!searchConfigured()) {
    console.error("No web search configured: run npm run search:start (SearXNG), or set SEARCH_PROVIDER=tavily and TAVILY_API_KEY.");
    process.exit(1);
  }

  let query = db
    .from("people")
    .select(
      "id, institution_id, full_name, first_name, last_name, current_title, city, state, " +
        "organizations:current_organization_id(name, domain, website), industries:industry_id(slug), contact_points(kind, value, source)" +
        (group ? ", group_memberships!inner(groups!inner(slug))" : ""),
    )
    .is("claimed_by_user_id", null) // members manage their own details
    .neq("status", "opted_out")
    .order("full_name");
  if (group) query = query.eq("group_memberships.groups.slug", group);
  const [{ data, error }, suppressed] = await Promise.all([query.returns<Row[]>(), db.from("suppression_list").select("full_name, email_sha256")]);
  if (error) throw error;
  if (suppressed.error) throw suppressed.error;
  const suppression = buildSuppression(suppressed.data);
  const people = data.filter((p) => !names || names.includes(p.full_name.toLowerCase())).slice(0, limit);
  console.log(`\n${people.length} profiles. ${write ? "Saving findings." : "Dry run (add --write to save)."}`);

  const ctx: Omit<SourceContext, "note"> = {
    env: process.env,
    search: async (text, options) =>
      (await webSearch(text, options)).flatMap((r) => (r.url ? [{ url: r.url, title: r.title ?? "", snippet: r.content ?? "" }] : [])),
    fetchPage: fetchPageText,
    async fetchJson(target, init) {
      const response = await fetch(target, { headers: { Accept: "application/json", ...init?.headers }, signal: AbortSignal.timeout(20_000) });
      // The URL can carry an API key, so errors name only the host.
      if (!response.ok) throw new Error(`${new URL(target).host} answered ${response.status}`);
      return response.json();
    },
  };

  const tally = { stored: 0, review: 0, dropped: 0, skipped: 0 };
  for (const row of people) {
    const report = await findContactsFor(toPerson(row), enabled, ctx, suppression);
    print(report);
    if (report.skipped) tally.skipped++;
    tally.dropped += report.dropped.length;
    for (const f of report.findings) tally[f.status === "stored" ? "stored" : "review"]++;
    if (!write || !report.findings.length) continue;

    const now = new Date().toISOString();
    // Findings already decided (or already queued) are left exactly as they are.
    const { error: findingsError } = await db.from("contact_findings").upsert(
      report.findings.map((f) => ({
        person_id: row.id,
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
          person_id: row.id,
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
          { person_id: row.id, field: "contact_points", source: f.source, confidence: f.confidence, source_url: f.sourceUrl, fetched_at: now },
          { onConflict: "person_id,field,source" },
        );
      if (provenanceError) throw provenanceError;
    }
  }

  console.log(
    `\n${write ? "Saved" : "Would save"}: ${tally.stored} stored privately, ${tally.review} for review at /admin/contacts. ` +
      `${tally.dropped} dropped, ${tally.skipped} people skipped.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
