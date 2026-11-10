import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { formatUsPhone } from "@/lib/enrichment/contacts/extract";
import { CONTACT_CHECK_LABELS, CONTACT_REVIEW_REASON_LABELS } from "@/lib/labels";
import { SOURCE_LABELS } from "@/lib/provenance";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";
import { decideContactFinding } from "../actions";

export const metadata: Metadata = { title: "Contact details review" };

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

function Decision({ finding, decision, label, primary }: { finding: FindingRow; decision: string; label: string; primary?: boolean }) {
  return (
    <form action={decideContactFinding}>
      <input type="hidden" name="finding_id" value={finding.id} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className={`btn${primary ? " primary" : decision === "reject" ? " danger" : ""}`}>
        {label}
      </button>
    </form>
  );
}

function Findings({ rows, stored }: { rows: FindingRow[]; stored: boolean }) {
  return (
    <div className="table-wrap">
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
                <div className="od-cluster">
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
  const { result } = await searchParams;
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
            <EmptyState title="Nothing is waiting" text="Findings from the contact pipeline that need a person’s judgment will appear here." />
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
        title="Check a found detail before anyone sees it."
        description="Emails and phone numbers found on public pages or through licensed providers. Each shows where it came from and the exact text it was read from. Only details a member enters themselves skip this step."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
