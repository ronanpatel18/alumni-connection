import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { Icon } from "@/components/icon";
import { Avatar, EmptyState, PageTitle } from "@/components/person";
import { REVIEW_REASON_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";

export const metadata: Metadata = { title: "Profile review" };

interface QueueRow {
  person_id: string;
  full_name: string;
  photo_url: string | null;
  current_title: string | null;
  employer: string | null;
  market: string | null;
  alumni_status: string;
  reasons: string[];
}

async function Queue({ searchParams }: { searchParams: PageProps<"/admin/review">["searchParams"] }) {
  await requireAdmin("/admin/review");
  const { saved } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_review_queue");
  const rows = (data ?? []) as QueueRow[];
  const counts = Object.keys(REVIEW_REASON_LABELS).map((code) => ({ code, count: rows.filter((r) => r.reasons.includes(code)).length }));

  return (
    <>
      {saved === "1" && (
        <div className="notice success" role="status" style={{ marginBottom: 24 }}>
          <Icon name="check" />
          <div>Review saved. Corrections now show on the profile, marked as checked by an administrator.</div>
        </div>
      )}
      <section className="panel">
        <div className="table-title">
          <div className="section-head" style={{ margin: 0 }}>
            <h2>Profile review queue</h2>
            <span className="badge-count">{rows.length} awaiting review</span>
          </div>
          <p className="meta" style={{ marginTop: 8 }}>
            Unclaimed profiles built from public sources with something missing or unconfirmed. Members edit their own profiles, so
            claimed ones never appear here.
          </p>
          {rows.length > 0 && (
            <div className="od-cluster" style={{ marginTop: 16 }}>
              {counts
                .filter((c) => c.count > 0)
                .map((c) => (
                  <span key={c.code} className="chip subtle">
                    {REVIEW_REASON_LABELS[c.code]}: {c.count}
                  </span>
                ))}
            </div>
          )}
        </div>
        {error ? (
          <div className="pad">
            <div className="notice error" role="alert">
              <Icon name="info" />
              <div>The queue couldn’t be loaded. Refresh to try again.</div>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="The queue is clear"
            text="New profiles with missing or unconfirmed details will appear here. A clear queue doesn’t mean every profile is confirmed."
          />
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Needs review</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person_id}>
                    <td>
                      <div className="od-row" style={{ alignItems: "center" }}>
                        <Avatar name={r.full_name} photoUrl={r.photo_url} confirmed={false} size="small" />
                        <div>
                          <strong>{r.full_name}</strong>
                          <p className="meta">{[[r.current_title, r.employer].filter(Boolean).join(" · "), r.market].filter(Boolean).join(" — ") || "No role or location yet"}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="od-cluster">
                        {r.reasons.map((code) => (
                          <span key={code} className="chip">
                            {REVIEW_REASON_LABELS[code] ?? code}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Link className="btn" href={`/admin/review/${r.person_id}`}>
                        Review profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function ReviewQueuePage({ searchParams }: PageProps<"/admin/review">) {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Profile review"
        title="Give uncertain data a human review."
        description="Check each profile against its sources before correcting it. Reviewing never marks a person as confirmed; only they can, by claiming it."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
