import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { initialsFor } from "@/components/account-block";
import { Icon } from "@/components/icon";
import { PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { type IntroDetails, introDetails, introStatusText, isOpen } from "@/lib/introductions";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { cancelIntro, decideIntro, recordMeeting } from "../actions";

export const metadata: Metadata = { title: "Introduction" };

const first = (name: string) => name.split(" ")[0];

function IntroSteps({ d }: { d: IntroDetails }) {
  const step = d.status === "pending_connector" ? 0 : d.status === "pending_target" ? 1 : d.status === "accepted" ? 2 : -1;
  const labels = [`${first(d.connector_name)} agrees`, `${first(d.target_name)} agrees`, "Introduction made"];
  return (
    <ol className="steps" style={{ marginTop: 24, marginBottom: 0 }} aria-label="Introduction progress">
      {labels.map((label, i) => (
        <li key={label} className={`step${i === step ? " active" : ""}`} aria-current={i === step ? "step" : undefined}>
          <b>{i < step || d.status === "accepted" ? <Icon name="check" /> : i + 1}</b>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Decision({ d, role, yes, no }: { d: IntroDetails; role: "connector" | "recipient"; yes: string; no: string }) {
  return (
    <div className="form-actions">
      <form action={decideIntro}>
        <input type="hidden" name="intro_id" value={d.id} />
        <input type="hidden" name="role" value={role} />
        <button type="submit" name="choice" value="yes" className="btn primary">
          {yes}
        </button>
      </form>
      <form action={decideIntro}>
        <input type="hidden" name="intro_id" value={d.id} />
        <input type="hidden" name="role" value={role} />
        <button type="submit" name="choice" value="no" className="btn">
          {no}
        </button>
      </form>
    </div>
  );
}

/** For the two people introduced, once it's done. Shows what they said, and lets them say it. */
function Outcome({ introId, iMet, otherMet, name }: { introId: string; iMet: boolean; otherMet: boolean; name: string }) {
  if (iMet) return <p className="small muted">You’ve recorded that you met {name}.</p>;
  return (
    <form action={recordMeeting} className="od-cluster">
      <input type="hidden" name="intro_id" value={introId} />
      <button type="submit" className="btn">
        We met
      </button>
      <span className="meta">{otherMet ? `${name} has recorded that you met.` : "Let us know if this introduction led to a meeting."}</span>
    </form>
  );
}

async function Intro({ params, searchParams }: { params: PageProps<"/introductions/[id]">["params"]; searchParams: PageProps<"/introductions/[id]">["searchParams"] }) {
  const { id } = await params;
  const { sent, decided } = await searchParams;
  const viewer = await requireMember(`/introductions/${id}`);
  const supabase = await createClient();
  const d = await introDetails(supabase, id);
  if (!d) notFound();
  const status = introStatusText(d);
  const { data: meetings } = await supabase.from("intro_events").select("actor_user_id").eq("intro_id", id).eq("action", "met");
  const iMet = (meetings ?? []).some((m) => m.actor_user_id === viewer.userId);
  const otherMet = (meetings ?? []).some((m) => m.actor_user_id !== viewer.userId);

  const notice =
    sent === "1" ? (
      <div className="notice success" role="status">
        <Icon name="check" />
        <div>Request sent to {first(d.connector_name)}. {first(d.target_name)} isn’t asked unless they agree.</div>
      </div>
    ) : decided === "1" ? (
      <div className="notice success" role="status">
        <Icon name="check" />
        <div>Your decision is recorded. {status}.</div>
      </div>
    ) : null;

  if (d.my_role === "connector") {
    return (
      <section className="panel pad narrow stack">
        {notice}
        <div className="od-cluster">
          <span className="chip">Your consent as the connector</span>
          <span className={`chip${d.status === "pending_connector" ? "" : " subtle"}`}>{status}</span>
        </div>
        <h2>
          {d.requester_name} would like to meet {d.target_name}.
        </h2>
        {d.requester_headline && <p className="small muted">{d.requester_headline}</p>}
        <div className="notice">
          <div>
            <strong>Why they’d like to meet</strong>
            <p>{d.goal}</p>
          </div>
        </div>
        <p className="small muted">
          Agreeing asks {first(d.target_name)} privately whether they’d like the introduction.
        </p>
        {d.status === "pending_connector" && <Decision d={d} role="connector" yes="I’m happy to introduce them" no="Decline quietly" />}
        <p className="meta">A decline closes the request without asking for a reason.</p>
      </section>
    );
  }

  if (d.my_role === "recipient") {
    return (
      <section className="panel pad narrow stack">
        {notice}
        <div className="od-cluster">
          <span className="chip">Your consent</span>
          <span className={`chip${d.status === "pending_target" ? "" : " subtle"}`}>{status}</span>
        </div>
        <h2>
          {d.connector_name} would like to introduce you to {d.requester_name}.
        </h2>
        {d.requester_headline && <p className="small muted">{d.requester_headline}</p>}
        <div className="notice">
          <div>
            <strong>Why {first(d.requester_name)} would like to connect</strong>
            <p>{d.goal}</p>
          </div>
        </div>
        <p className="small muted">
          Accepting records the introduction for both of you. If you decline, nobody is told it was you.
        </p>
        {d.status === "pending_target" && <Decision d={d} role="recipient" yes="Accept introduction" no="Not right now" />}
        {d.status === "accepted" && <Outcome introId={d.id} iMet={iMet} otherMet={otherMet} name={first(d.requester_name)} />}
      </section>
    );
  }

  // The requester: progress and the option to cancel; never anyone else's controls.
  return (
    <div className="split">
      <section className="panel pad stack">
        {notice}
        <div className="network-graphic" aria-label={`You, ${d.connector_name}, ${d.target_name}`}>
          <span className="avatar small red">You</span>
          <span className="network-line" />
          <span className="avatar">{initialsFor(d.connector_name)}</span>
          <span className="network-line" />
          <span className="avatar small">{initialsFor(d.target_name)}</span>
        </div>
        <h2>
          You → {d.connector_name} → {d.target_name}
        </h2>
        <p className="small muted">{status}</p>
        <IntroSteps d={d} />
        <div className="notice">
          <div>
            <strong>Your reason</strong>
            <p>{d.goal}</p>
          </div>
        </div>
        {d.status === "accepted" ? (
          <div className="notice success">
            <Icon name="check" />
            <div>
              <p>
                Both {first(d.connector_name)} and {first(d.target_name)} agreed.{" "}
                {viewer.personId ? "You’re now connected." : "Claim your own profile to show this connection on it."}
              </p>
              <p>
                <Link href={`/messages/new?person=${d.target_id}`}>Send {first(d.target_name)} a message</Link>
                {" · "}
                <Link href={`/people/${d.target_id}`}>Open their profile</Link>
              </p>
              <div style={{ marginTop: 12 }}>
                <Outcome introId={d.id} iMet={iMet} otherMet={otherMet} name={first(d.target_name)} />
              </div>
            </div>
          </div>
        ) : isOpen(d.status) ? (
          <form action={cancelIntro}>
            <input type="hidden" name="intro_id" value={d.id} />
            <button type="submit" className="btn quiet" style={{ paddingInline: 0 }}>
              Cancel request
            </button>
          </form>
        ) : null}
      </section>
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">What happens next</h2>
          <p className="small muted">
            {first(d.connector_name)} decides first; {first(d.target_name)} is asked only if they agree. Requests close after 30 days (
            {new Date(d.expires_at).toLocaleDateString()}) if no one decides.
          </p>
        </section>
      </aside>
    </div>
  );
}

export default function IntroPage({ params, searchParams }: PageProps<"/introductions/[id]">) {
  return (
    <>
      <PageTitle eyebrow="Relationships / Introductions" title="A warm introduction takes two yeses." />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Intro params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
