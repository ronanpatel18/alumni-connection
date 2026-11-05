import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { AutoSubmit } from "@/components/auto-submit";
import { EmptyState, PageTitle } from "@/components/person";
import { getVocabulary } from "@/lib/search/vocabulary";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";

export const metadata: Metadata = { title: "Pilot progress" };

interface Metrics {
  invited: number;
  claimed: number;
  in_review: number;
  waiting: number;
  expired: number;
  removed: number | null;
  members: number;
  with_preferences: number;
  reachable_by_intro: number;
}

interface IntroMetrics {
  requested: number;
  awaiting_connector: number;
  awaiting_recipient: number;
  accepted: number;
  declined: number;
  closed: number;
  met: number;
  emails_waiting: number;
  emails_failed: number;
}

const share = (part: number, whole: number) => (whole ? ` (${Math.round((part / whole) * 100)}%)` : "");

function Row({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="detail-row">
      <strong className="small">
        {label}: {value}
      </strong>
      {note && <span className="meta">{note}</span>}
    </div>
  );
}

async function Progress({ searchParams }: { searchParams: PageProps<"/admin/pilot">["searchParams"] }) {
  await requireAdmin("/admin/pilot");
  const { group } = await searchParams;
  const { groups } = await getVocabulary();
  const cohort = groups.find((g) => g.slug === group) ?? null;

  const supabase = await createClient();
  const [pilot, intros] = await Promise.all([
    supabase.rpc("admin_pilot_metrics", { p_group_slug: cohort?.slug ?? null }),
    supabase.rpc("admin_intro_metrics", { p_group_slug: cohort?.slug ?? null }),
  ]);
  if (pilot.error) throw pilot.error;
  if (intros.error) throw intros.error;
  const m = pilot.data as Metrics;
  const i = intros.data as IntroMetrics;
  const conversion = m.invited ? Math.round((m.claimed / m.invited) * 100) : null;

  return (
    <>
      <form id="pilot-cohort" className="filter-row" method="get" style={{ marginBottom: 24 }}>
        <label className="sr-only" htmlFor="group">
          Cohort
        </label>
        <select key={cohort?.slug ?? "all"} id="group" name="group" defaultValue={cohort?.slug ?? ""}>
          <option value="">All alumni</option>
          {groups.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
        <AutoSubmit formId="pilot-cohort" />
      </form>
      <div className="split">
        <section className="panel pad">
          <h2>Invitations</h2>
          {m.invited === 0 ? (
            <EmptyState title="No invitations yet" text="Create claim links with npm run links:generate, then send them to this cohort." />
          ) : (
            <div className="detail-list" style={{ marginTop: 16 }}>
              <Row label="Invited" value={m.invited} note="People with a claim link. Links are sent outside the app, so delivery isn’t tracked." />
              <Row label="Claimed" value={`${m.claimed} (${conversion}%)`} />
              <Row label="Awaiting identity review" value={m.in_review} />
              <Row label="No response yet" value={m.waiting} />
              <Row label="Link expired" value={m.expired} />
              <Row label="Removed themselves" value={m.removed ?? "Not known per cohort"} note={m.removed === null ? "A removed person’s group isn’t kept. See All alumni for the total." : undefined} />
            </div>
          )}
          <h2 style={{ marginTop: 32 }}>Introductions</h2>
          {i.requested === 0 ? (
            <p className="small muted" style={{ marginTop: 12 }}>
              No introductions requested yet.
            </p>
          ) : (
            <div className="detail-list" style={{ marginTop: 16 }}>
              <Row label="Requested" value={i.requested} />
              <Row label="Waiting for the connector" value={i.awaiting_connector} />
              <Row label="Waiting for the recipient" value={i.awaiting_recipient} />
              <Row label="Accepted" value={`${i.accepted}${share(i.accepted, i.accepted + i.declined)}`} note="Share of introductions someone decided on." />
              <Row label="Declined" value={i.declined} note="Totals only. Who declined stays private." />
              <Row label="Cancelled or expired" value={i.closed} />
              <Row label="Led to a meeting" value={`${i.met}${share(i.met, i.accepted)}`} note="Recorded by either person, so real meetings may be higher." />
            </div>
          )}
        </section>
        <aside className="stack right-rail">
          <section className="panel pad">
            <h2>Reachable alumni</h2>
            <div className="detail-list" style={{ marginTop: 16 }}>
              <Row label="By message" value={m.members} note="Every member can be messaged." />
              <Row label="By introduction" value={m.reachable_by_intro} note="Members another member shares a group or recorded connection with." />
              <Row label="Shared what they’re open to" value={m.with_preferences} />
            </div>
          </section>
          <section className="panel pad">
            <h2>Email delivery</h2>
            <div className="detail-list" style={{ marginTop: 16 }}>
              <Row label="Waiting to send" value={i.emails_waiting} note="Includes retries. Covers all alumni, not only this cohort." />
              <Row label="Gave up" value={i.emails_failed} note="Failed five times, or there was no address to send to." />
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function PilotPage({ searchParams }: PageProps<"/admin/pilot">) {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Pilot progress"
        title="Are invitations turning into connections?"
        description="Follow one cohort from invitation to claimed profile, and see how many alumni can be reached."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Progress searchParams={searchParams} />
      </Suspense>
    </>
  );
}
