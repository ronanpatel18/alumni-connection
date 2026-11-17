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
import { findContactsFor, type PersonReport } from "@/lib/enrichment/contacts/pipeline";
import { CONTACT_PERSON_COLUMNS, type ContactPersonRow, loadSuppression, networkContext, saveReport, toPersonRef } from "@/lib/enrichment/contacts/run";
import { CONTACT_SOURCES } from "@/lib/enrichment/contacts/sources";
import { configuredVerifier } from "@/lib/enrichment/contacts/validate";
import { searchConfigured } from "@/lib/enrichment/search";

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
    .select(CONTACT_PERSON_COLUMNS + (group ? ", group_memberships!inner(groups!inner(slug))" : ""))
    .is("claimed_by_user_id", null) // members manage their own details
    .neq("status", "opted_out")
    .order("full_name");
  if (group) query = query.eq("group_memberships.groups.slug", group);
  const [{ data, error }, suppression] = await Promise.all([query.returns<ContactPersonRow[]>(), loadSuppression(db)]);
  if (error) throw error;
  const people = data.filter((p) => !names || names.includes(p.full_name.toLowerCase())).slice(0, limit);
  console.log(`\n${people.length} profiles. ${write ? "Saving findings." : "Dry run (add --write to save)."}`);

  const ctx = networkContext();
  const tally = { stored: 0, review: 0, dropped: 0, skipped: 0 };
  for (const row of people) {
    const report = await findContactsFor(toPersonRef(row), enabled, ctx, suppression);
    print(report);
    if (report.skipped) tally.skipped++;
    tally.dropped += report.dropped.length;
    for (const f of report.findings) tally[f.status === "stored" ? "stored" : "review"]++;
    if (write) await saveReport(db, row.id, report);
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
