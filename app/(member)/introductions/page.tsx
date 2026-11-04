import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { type IntroDetails, introDetails, introStatusText, isOpen } from "@/lib/introductions";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Introductions" };

async function IntroList() {
  const viewer = await requireMember("/introductions");
  const supabase = await createClient();
  // Row-level security returns only requests this member is a party to
  // (recipients see a request only after the connector agrees).
  const { data } = await supabase.from("intro_requests").select("id").order("updated_at", { ascending: false }).limit(100);
  const all = (await Promise.all((data ?? []).map((r) => introDetails(supabase, r.id as string)))).filter((d): d is IntroDetails => Boolean(d));
  const forMe = all.filter(
    (d) => (d.my_role === "connector" && d.status === "pending_connector") || (d.my_role === "recipient" && d.status === "pending_target"),
  );
  const mine = all.filter((d) => d.my_role === "requester");
  const others = all.filter((d) => d.my_role !== "requester" && !forMe.includes(d));

  const row = (d: IntroDetails) => (
    <Link key={d.id} href={`/introductions/${d.id}`} className="intro-row">
      <strong>
        {d.my_role === "requester"
          ? `You → ${d.connector_name} → ${d.target_name}`
          : d.my_role === "connector"
            ? `${d.requester_name} would like to meet ${d.target_name}`
            : `${d.connector_name} would like to introduce you to ${d.requester_name}`}
      </strong>
      <span className="meta">
        {introStatusText(d)} · {new Date(d.created_at).toLocaleDateString()}
      </span>
    </Link>
  );

  if (!all.length) {
    return (
      <section className="panel">
        <EmptyState
          title="No introductions yet"
          text="Open someone’s profile and ask a member you both know to introduce you. Nobody is connected without agreeing."
          action={
            <Link className="btn primary" href="/discover/who-to-meet">
              Find people worth meeting
            </Link>
          }
        />
      </section>
    );
  }
  return (
    <div className="stack">
      {forMe.length > 0 && (
        <section className="panel">
          <div className="table-title">
            <div className="section-head" style={{ margin: 0 }}>
              <h2>Waiting for your decision</h2>
              <span className="badge-count">{forMe.length}</span>
            </div>
          </div>
          {forMe.map(row)}
        </section>
      )}
      <section className="panel">
        <div className="table-title">
          <h2>You asked</h2>
          <p className="meta" style={{ marginTop: 8 }}>
            {mine.filter((d) => isOpen(d.status)).length} open · requests close after 30 days
          </p>
        </div>
        {mine.length ? mine.map(row) : <p className="pad small muted">You haven’t asked for an introduction yet.</p>}
      </section>
      {others.length > 0 && (
        <section className="panel">
          <div className="table-title">
            <h2>Decided</h2>
          </div>
          {others.map(row)}
        </section>
      )}
      {viewer.personId ? null : (
        <p className="footnote">Others can ask you to make introductions once you’ve claimed your profile.</p>
      )}
    </div>
  );
}

export default function IntroductionsPage() {
  return (
    <>
      <PageTitle
        eyebrow="Relationships / Introductions"
        title="Start with someone you both know."
        description="A warm introduction takes two yeses. Nobody is connected without their consent."
      />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <IntroList />
      </Suspense>
    </>
  );
}
