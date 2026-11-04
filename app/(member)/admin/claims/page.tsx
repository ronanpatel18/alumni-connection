import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { DialogButton } from "@/components/dialog-button";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";
import { decideClaim } from "../actions";

export const metadata: Metadata = { title: "Claim requests" };

const RESULT_MESSAGES: Record<string, { tone: "success" | "error" | ""; text: string }> = {
  approved: { tone: "success", text: "Claim approved. The profile is linked to their account and they’re a verified member." },
  rejected: { tone: "", text: "Claim declined. Nothing was linked." },
  already_decided: { tone: "error", text: "That request was already decided." },
  already_claimed: { tone: "error", text: "Someone else has already claimed that profile." },
  has_other_profile: { tone: "error", text: "That account is already linked to a different profile." },
  no_account: { tone: "error", text: "The requester’s account no longer exists." },
  not_found: { tone: "error", text: "That request no longer exists." },
  error: { tone: "error", text: "The decision couldn’t be saved. Try again." },
};

interface ClaimRow {
  id: string;
  person_id: string;
  user_id: string;
  created_at: string;
  people: { full_name: string; contact_points: { kind: string; value: string }[] } | null;
}

async function Claims({ searchParams }: { searchParams: PageProps<"/admin/claims">["searchParams"] }) {
  await requireAdmin("/admin/claims");
  const { result } = await searchParams;
  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("claim_requests")
    .select("id, person_id, user_id, created_at, people(full_name, contact_points(kind, value))")
    .eq("status", "pending")
    .order("created_at")
    .returns<ClaimRow[]>();
  const userIds = (requests ?? []).map((r) => r.user_id);
  const { data: members } = userIds.length
    ? await supabase.from("members").select("user_id, email").in("user_id", userIds)
    : { data: [] as { user_id: string; email: string }[] };
  const emailOf = new Map((members ?? []).map((m) => [m.user_id, m.email as string]));
  const message = typeof result === "string" ? RESULT_MESSAGES[result] : undefined;

  return (
    <>
      {message && (
        <div className={`notice ${message.tone}`.trim()} role={message.tone === "error" ? "alert" : "status"} style={{ marginBottom: 24 }}>
          <Icon name={message.tone === "error" ? "info" : "check"} />
          <div>{message.text}</div>
        </div>
      )}
      <section className="panel">
        <div className="table-title">
          <div className="section-head" style={{ margin: 0 }}>
            <h2>Claim requests</h2>
            <span className="badge-count">{requests?.length ?? 0} pending</span>
          </div>
          <p className="meta" style={{ marginTop: 8 }}>
            People who used their private link but signed in with an email that isn’t on file. Approving confirms their identity; it
            doesn’t endorse what the profile says.
          </p>
        </div>
        {!requests?.length ? (
          <EmptyState title="No pending requests" text="Claims that can’t be matched by email will appear here." />
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Signed in as</th>
                  <th>Emails on file</th>
                  <th>
                    <span className="sr-only">Decision</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const name = r.people?.full_name ?? "Removed profile";
                  const onFile = r.people?.contact_points.filter((c) => c.kind === "email").map((c) => c.value) ?? [];
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/people/${r.person_id}`}>
                          <strong>{name}</strong>
                        </Link>
                        <p className="meta">Requested {new Date(r.created_at).toLocaleDateString()}</p>
                      </td>
                      <td className="small">{emailOf.get(r.user_id) ?? "Unknown account"}</td>
                      <td className="small">{onFile.length ? onFile.join(", ") : <span className="muted">None on file</span>}</td>
                      <td>
                        <DialogButton label="Decide" title={`Is this ${name}?`} className="btn">
                          <p className="small muted">
                            Approve only with evidence it’s really them, such as a reply from an email address on file, a roster match, or a
                            call. Your decision is recorded in the audit log.
                          </p>
                          <div className="detail-list" style={{ marginTop: 16 }}>
                            <div className="detail-row">
                              <strong className="small">Signed in as</strong>
                              <span className="small">{emailOf.get(r.user_id) ?? "Unknown account"}</span>
                            </div>
                            <div className="detail-row">
                              <strong className="small">Emails on file</strong>
                              <span className="small">{onFile.length ? onFile.join(", ") : "None"}</span>
                            </div>
                          </div>
                          <div className="form-actions">
                            <form action={decideClaim}>
                              <input type="hidden" name="request_id" value={r.id} />
                              <button type="submit" name="decision" value="approve" className="btn primary">
                                Approve and link profile
                              </button>
                            </form>
                            <form action={decideClaim}>
                              <input type="hidden" name="request_id" value={r.id} />
                              <button type="submit" name="decision" value="decline" className="btn danger">
                                Decline
                              </button>
                            </form>
                          </div>
                        </DialogButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function ClaimRequestsPage({ searchParams }: PageProps<"/admin/claims">) {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Claim requests"
        title="Protect the shared trust."
        description="Confirm it’s really them before linking a profile to someone’s account."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Claims searchParams={searchParams} />
      </Suspense>
    </>
  );
}
