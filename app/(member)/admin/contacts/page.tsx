import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { formatUsPhone } from "@/lib/enrichment/contacts/extract";
import { contactProgress, SEARCH_STALLED_MS } from "@/lib/enrichment/contacts/run";
import { searchConfigured } from "@/lib/enrichment/providers";
import { CONTACT_CHECK_LABELS, CONTACT_REVIEW_REASON_LABELS } from "@/lib/labels";
import { SOURCE_LABELS } from "@/lib/provenance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";
import { decideContactFinding } from "../actions";
import { RefreshWhileSearching } from "../people/add-people-form";
import { findContacts, findContactsForPerson } from "./actions";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = { title: "Contact details" };
// Where no background queue is reachable, a search runs after the response.
export const maxDuration = 300;

interface FindingRow {
  id: string;
  person_id: string;
  full_name: string;
  current_title: string | null;
  employer: string | null;
  kind: "email" | "phone";
  value: string;
  label: string;
  source: string;
  source_detail: string | null;
  source_url: string;
  evidence_quote: string;
  confidence: number;
  verification: { status?: string; method?: string };
  pattern_guessed: boolean;
  review_reasons: string[];
}

const RESULTS: Record<string, { tone: "success" | "error"; text: string }> = {
  shown: { tone: "success", text: "Approved. The detail now shows on the profile to verified members, with its source." },
  kept: { tone: "success", text: "Approved and kept private. It’s used only to match a claim, and isn’t shown to members." },
  rejected: { tone: "success", text: "Rejected. The value was discarded and won’t be suggested from that source again." },
  not_allowed: { tone: "error", text: "That detail can’t be shown: only work details that passed a validity check can. You can keep it private or reject it." },
  error: { tone: "error", text: "The decision couldn’t be saved. Refresh and try again." },
};

/** Can this finding be shown to members at all? Mirrors the check in admin_decide_contact_finding. */
function canShow(f: FindingRow) {
  if (f.label !== "work") return false;
  const status = f.verification.status ?? "unknown";
  if (f.kind === "email") return status === "valid" || (status === "domain_ok" && !f.pattern_guessed);
  return status !== "invalid";
}

const SEARCH_RESULTS: Record<string, { tone: "success" | "error"; text: string }> = {
  nosearch: { tone: "error", text: "No web search is set up, so nothing was searched. Add a search key first." },
  error: { tone: "error", text: "The search couldn’t be started. Refresh and try again." },
  "0": { tone: "success", text: "A search is already running, or every profile has been searched." },
};

interface SearchRow {
  person_id: string;
  status: "running" | "done" | "failed";
  stored: number;
  pending: number;
  note: string | null;
  started_at: string;
  people: { full_name: string; current_title: string | null; organizations: { name: string } | null };
}

function outcome(row: SearchRow, stalled: boolean) {
  if (stalled) return <span className="chip whitespace-nowrap">Didn’t finish</span>;
  if (row.status === "running") return <span className="chip ai whitespace-nowrap">Searching…</span>;
  if (row.status === "failed") return <span className="chip whitespace-nowrap">Search failed</span>;
  const found = row.stored + row.pending;
  if (!found) return <span className="chip subtle whitespace-nowrap">Nothing found</span>;
  return <span className="chip success whitespace-nowrap">{found === 1 ? "1 detail found" : `${found} details found`}</span>;
}

/** Search progress and the latest searches, each marked if it was cut off. */
async function loadSearches() {
  const db = createAdminClient();
  const [progress, latest] = await Promise.all([
    contactProgress(db).catch(() => null),
    db
      .from("contact_searches")
      .select("person_id, status, stored, pending, note, started_at, people!inner(full_name, current_title, organizations:current_organization_id(name))")
      .order("started_at", { ascending: false })
      .order("person_id")
      .limit(10)
      .returns<SearchRow[]>(),
  ]);
  const now = Date.now();
  const rows = (latest.data ?? []).map((row) => ({ ...row, stalled: row.status === "running" && now - Date.parse(row.started_at) > SEARCH_STALLED_MS }));
  return { progress, rows };
}

/** Starts searches and shows how far through the directory they've got. */
async function Finder({ started }: { started: string | undefined }) {
  const { progress, rows } = await loadSearches();
  const running = progress?.running ?? 0;
  const ready = searchConfigured();
  const remaining = progress?.next.length ?? 0;
  const notice = started === undefined ? undefined : (SEARCH_RESULTS[started] ?? (/^\d+$/.test(started) ? { tone: "success" as const, text: `Searching ${started === "1" ? "1 profile" : `${started} profiles`} now. Results appear below as each finishes.` } : undefined));

  return (
    <section className="panel">
      {running > 0 && <RefreshWhileSearching />}
      <div className="pad">
        <h2>Find contact details</h2>
        <p className="small muted" style={{ margin: "12px 0 16px", maxWidth: "75ch" }}>
          Looks for a work email and phone number for unclaimed profiles on their employer’s pages, professional registries and public
          listings. Every value is read from a page you can open, never guessed. Nothing found here is shown to members until you approve it below.
        </p>
        {notice && (
          <div className={`notice ${notice.tone}`} role={notice.tone === "success" ? "status" : "alert"} style={{ marginBottom: 16 }}>
            <Icon name={notice.tone === "success" ? "check" : "info"} />
            <div>{notice.text}</div>
          </div>
        )}
        {!progress && (
          <div className="notice error" role="alert" style={{ marginBottom: 16 }}>
            <Icon name="info" />
            <div>Search progress couldn’t be loaded. Refresh to try again.</div>
          </div>
        )}
        {!ready && (
          <div className="notice" role="status" style={{ marginBottom: 16 }}>
            <Icon name="info" />
            <div>No web search is set up, so searches can’t run. Add a search key first.</div>
          </div>
        )}
        <form action={findContacts} className="form-actions" style={{ marginTop: 0 }}>
          <SubmitButton
            className="btn primary"
            disabled={!ready || !progress || running > 0 || remaining === 0}
            pendingLabel="Starting…"
            label={running > 0 ? `Searching ${running === 1 ? "1 profile" : `${running} profiles`}…` : remaining ? `Search the next ${Math.min(10, remaining)}` : "Everyone has been searched"}
          />
          {progress && (
            <span className="meta">
              {progress.searched} of {progress.total} unclaimed {progress.total === 1 ? "profile" : "profiles"} searched
              {remaining > 10 ? ", 10 at a time." : "."}
            </span>
          )}
        </form>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap table-inset">
          <table className="responsive">
            <thead>
              <tr>
                <th>Latest searches</th>
                <th>Result</th>
                <th>
                  <span className="sr-only">Search again</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = row.status === "running" && !row.stalled;
                return (
                  <tr key={row.person_id}>
                    <td data-label="Person">
                      <Link href={`/people/${row.person_id}`}>
                        <strong>{row.people.full_name}</strong>
                      </Link>
                      <p className="meta">{[row.people.current_title, row.people.organizations?.name].filter(Boolean).join(" · ") || "No role on file"}</p>
                    </td>
                    <td data-label="Result">
                      {outcome(row, row.stalled)}
                      {!busy && (row.note || row.stored > 0 || row.pending > 0) && (
                        <p className="meta" style={{ marginTop: 8, maxWidth: "52ch" }}>
                          {[row.pending > 0 && `${row.pending} waiting for your decision`, row.stored > 0 && `${row.stored} stored privately`, row.note].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </td>
                    <td>
                      {!busy && (
                        <form action={findContactsForPerson}>
                          <input type="hidden" name="person_id" value={row.person_id} />
                          <SubmitButton label="Search again" pendingLabel="Starting…" disabled={!ready || running > 0} />
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Decision({ finding, decision, label, primary }: { finding: FindingRow; decision: string; label: string; primary?: boolean }) {
  return (
    <form action={decideContactFinding}>
      <input type="hidden" name="finding_id" value={finding.id} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className={`btn${primary ? " primary" : decision === "reject" ? " danger" : ""}`} style={{ width: "100%" }}>
        {label}
      </button>
    </form>
  );
}

function Findings({ rows, stored }: { rows: FindingRow[]; stored: boolean }) {
  return (
    <div className="table-wrap table-inset findings-queue">
      <table className="responsive">
        <thead>
          <tr>
            <th>Person</th>
            <th>Found detail</th>
            <th>Source and evidence</th>
            <th>
              <span className="sr-only">Decision</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td data-label="Person">
                <Link href={`/people/${f.person_id}`}>
                  <strong>{f.full_name}</strong>
                </Link>
                <p className="meta">{[f.current_title, f.employer].filter(Boolean).join(" · ") || "No role on file"}</p>
              </td>
              <td data-label="Found detail">
                <strong>{f.kind === "phone" ? formatUsPhone(f.value) : f.value}</strong>
                <p className="meta">
                  {f.label === "work" ? "Work" : "Personal"} {f.kind}
                  {f.pattern_guessed ? " · pattern-based, verifier-confirmed" : ""}
                </p>
                <p className="meta">{CONTACT_CHECK_LABELS[f.verification.status ?? "unknown"] ?? f.verification.status}</p>
                <div className="od-cluster" style={{ marginTop: 8 }}>
                  {f.review_reasons.map((code) => (
                    <span key={code} className="chip">
                      {CONTACT_REVIEW_REASON_LABELS[code] ?? code}
                    </span>
                  ))}
                </div>
              </td>
              <td data-label="Source and evidence">
                <p className="small">
                  {SOURCE_LABELS[f.source] ?? f.source}
                  {f.source_detail ? ` (${f.source_detail})` : ""}
                </p>
                <p className="meta" style={{ margin: "4px 0" }}>
                  “{f.evidence_quote}”
                </p>
                {/* API requests aren't pages a person can open. */}
                {/^https:\/\/(api\.|npiregistry\.)/.test(f.source_url) ? (
                  <span className="meta">From the provider’s API</span>
                ) : (
                  <a className="small" href={f.source_url} target="_blank" rel="noreferrer noopener">
                    Open the source page
                  </a>
                )}
              </td>
              <td>
                <div className="od-stack" style={{ ["--od-gap" as string]: "8px" }}>
                  {canShow(f) && <Decision finding={f} decision="show" label="Show to members" primary />}
                  {!stored && <Decision finding={f} decision="keep_private" label="Keep private" />}
                  <Decision finding={f} decision="reject" label="Reject" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Queue({ searchParams }: { searchParams: PageProps<"/admin/contacts">["searchParams"] }) {
  await requireAdmin("/admin/contacts");
  const { result, search } = await searchParams;
  const supabase = await createClient();
  const [pending, stored] = await Promise.all([
    supabase.rpc("admin_contact_queue", { p_status: "pending" }),
    supabase.rpc("admin_contact_queue", { p_status: "stored" }),
  ]);
  const needDecision = (pending.data ?? []) as FindingRow[];
  const storedPrivately = (stored.data ?? []) as FindingRow[];
  const notice = typeof result === "string" ? RESULTS[result] : undefined;

  return (
    <>
      {notice && (
        <div className={`notice ${notice.tone}`} role={notice.tone === "success" ? "status" : "alert"} style={{ marginBottom: 24 }}>
          <Icon name={notice.tone === "success" ? "check" : "info"} />
          <div>{notice.text}</div>
        </div>
      )}
      {(pending.error || stored.error) && (
        <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
          <Icon name="info" />
          <div>The queue couldn’t be loaded. Refresh to try again.</div>
        </div>
      )}
      <div className="stack">
        <Finder started={typeof search === "string" ? search : undefined} />
        <section className="panel">
          <div className="table-title">
            <div className="section-head" style={{ margin: 0 }}>
              <h2>Needs a decision</h2>
              <span className="badge-count">{needDecision.length} waiting</span>
            </div>
            <p className="meta" style={{ marginTop: 8 }}>
              Details that are uncertain, personal, conflicting or from a third party. They’re stored nowhere else and no member can see
              them until you decide. Check the quote against the source first.
            </p>
          </div>
          {needDecision.length ? (
            <Findings rows={needDecision} stored={false} />
          ) : (
            <EmptyState title="Nothing is waiting" text="Details a search finds that need your judgment will appear here." />
          )}
        </section>
        {storedPrivately.length > 0 && (
          <section className="panel">
            <div className="table-title">
              <div className="section-head" style={{ margin: 0 }}>
                <h2>Stored privately</h2>
                <span className="badge-count">{storedPrivately.length}</span>
              </div>
              <p className="meta" style={{ marginTop: 8 }}>
                Confident work details, kept private and used only to match a claim. Show one to members, or reject it to delete it.
              </p>
            </div>
            <Findings rows={storedPrivately} stored />
          </section>
        )}
      </div>
    </>
  );
}

export default function ContactReviewPage({ searchParams }: PageProps<"/admin/contacts">) {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Contact details"
        title="Find and check contact details."
        description="Search public pages and licensed providers for each person’s work email and phone. Each finding shows where it came from and the exact text it was read from, and you decide what members see. Only details a member enters themselves skip this step."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
