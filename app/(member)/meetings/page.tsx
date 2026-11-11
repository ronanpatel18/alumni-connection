import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { LocalTime } from "@/components/local-time";
import { ResultNotice } from "@/components/notice";
import { EmptyState, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { googleCalendarLink } from "@/lib/calendar";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { cancelMeeting, respondToMeeting, rotateCalendarFeed } from "./actions";

export const metadata: Metadata = { title: "Meetings" };

const RESULTS = {
  proposed: { text: "Invitation sent. It’s booked once they accept; you’ll get an email either way." },
  accepted: { text: "Booked. Add it to your calendar below." },
  declined: { text: "Declined. They’ve been told the time doesn’t work, with no reason given." },
  cancelled: { text: "Cancelled. The other person has been told." },
  feed: { text: "Your calendar address is ready. Any earlier address has stopped working." },
  error: { tone: "error" as const, text: "That couldn’t be saved. Refresh and try again." },
};

interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  location: string | null;
  note: string | null;
  status: "proposed" | "accepted" | "declined" | "cancelled";
  i_proposed: boolean;
  other_name: string;
  other_person_id: string | null;
}

const endOf = (m: Meeting) => new Date(Date.parse(m.starts_at) + m.duration_minutes * 60_000).toISOString();

async function loadMeetings() {
  const supabase = await createClient();
  const [{ data, error }, { data: feed }] = await Promise.all([
    supabase.rpc("my_meetings"),
    supabase.from("calendar_feeds").select("token").maybeSingle<{ token: string }>(),
  ]);
  const all = (data ?? []) as Meeting[];
  const now = new Date().toISOString();
  const ahead = all.filter((m) => endOf(m) >= now);
  return {
    error,
    toAnswer: ahead.filter((m) => m.status === "proposed" && !m.i_proposed),
    booked: ahead.filter((m) => m.status === "accepted"),
    waiting: ahead.filter((m) => m.status === "proposed" && m.i_proposed),
    earlier: all.filter((m) => endOf(m) < now || m.status === "declined" || m.status === "cancelled").reverse().slice(0, 30),
    feedUrl: feed ? `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/^https?:/, "webcal:")}/calendar/${feed.token}` : null,
  };
}

function Card({ m, group }: { m: Meeting; group: "toAnswer" | "booked" | "waiting" | "earlier" }) {
  const who = m.other_person_id ? <Link href={`/people/${m.other_person_id}`}>{m.other_name}</Link> : m.other_name;
  const label = { proposed: m.i_proposed ? "Waiting for their answer" : "Needs your answer", accepted: "Booked", declined: "Declined", cancelled: "Cancelled" }[m.status];
  return (
    <div className="detail-row" style={{ padding: "20px 24px" }}>
      <div className="od-cluster" style={{ justifyContent: "space-between" }}>
        <strong>{m.title}</strong>
        <span className={m.status === "accepted" && group !== "earlier" ? "chip success" : group === "toAnswer" ? "chip ai" : "chip subtle"}>
          {group === "earlier" && m.status === "accepted" ? "Took place" : label}
        </span>
      </div>
      <p className="small">
        <Icon name="calendar" /> <LocalTime iso={m.starts_at} /> · {m.duration_minutes} minutes · with {who}
      </p>
      {m.location && (
        <p className="small muted">
          <Icon name="pin" /> {m.location}
        </p>
      )}
      {m.note && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{m.note}</p>}
      {group !== "earlier" && (
        <div className="od-cluster">
          {group === "toAnswer" && (
            <>
              <form action={respondToMeeting}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="decision" value="accept" />
                <button type="submit" className="btn primary">
                  Accept
                </button>
              </form>
              <form action={respondToMeeting}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="decision" value="decline" />
                <button type="submit" className="btn">
                  Can’t make it
                </button>
              </form>
            </>
          )}
          {group === "booked" && (
            <>
              <a className="btn" href={`/meetings/${m.id}/calendar`}>
                <Icon name="calendar" /> Calendar file
              </a>
              <a
                className="btn"
                target="_blank"
                rel="noreferrer noopener"
                href={googleCalendarLink({ title: `${m.title} (${m.other_name})`, start: m.starts_at, end: endOf(m), location: m.location, description: m.note })}
              >
                Add to Google Calendar
              </a>
            </>
          )}
          {m.other_person_id && (
            <Link className="btn quiet" href={`/messages/new?person=${m.other_person_id}`}>
              Message
            </Link>
          )}
          {group !== "toAnswer" && (
            <form action={cancelMeeting}>
              <input type="hidden" name="id" value={m.id} />
              <button type="submit" className="btn quiet">
                Cancel meeting
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, rows, group }: { title: string; rows: Meeting[]; group: "toAnswer" | "booked" | "waiting" | "earlier" }) {
  if (!rows.length) return null;
  return (
    <section className="panel">
      <div className="table-title" style={{ paddingBottom: 0 }}>
        <div className="section-head" style={{ margin: 0 }}>
          <h2>{title}</h2>
          <span className="badge-count">{rows.length}</span>
        </div>
      </div>
      <div className="detail-list">{rows.map((m) => <Card key={m.id} m={m} group={group} />)}</div>
    </section>
  );
}

async function Meetings({ searchParams }: { searchParams: PageProps<"/meetings">["searchParams"] }) {
  await requireMember("/meetings");
  const { result } = await searchParams;
  const { error, toAnswer, booked, waiting, earlier, feedUrl } = await loadMeetings();
  if (error) throw error;
  const none = !toAnswer.length && !booked.length && !waiting.length && !earlier.length;

  return (
    <div className="split">
      <div className="stack">
        <ResultNotice result={result} messages={RESULTS} />
        {none && (
          <section className="panel">
            <EmptyState
              title="No meetings yet"
              text="Open a member’s profile and choose Propose a meeting. They accept or decline, and a booked meeting shows here for both of you."
              action={
                <Link className="btn primary" href="/search">
                  Find alumni
                </Link>
              }
            />
          </section>
        )}
        <Group title="Waiting for your answer" rows={toAnswer} group="toAnswer" />
        <Group title="Booked" rows={booked} group="booked" />
        <Group title="Waiting for their answer" rows={waiting} group="waiting" />
        <Group title="Earlier" rows={earlier} group="earlier" />
      </div>
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">See these in your calendar</h2>
          <p className="small muted">
            Subscribe once and your booked meetings, the events you’re going to and your follow-up dates show up in Google Calendar, Apple
            Calendar or Outlook, and stay up to date.
          </p>
          {feedUrl && (
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="feed">Your private calendar address</label>
              <input id="feed" readOnly value={feedUrl} />
              <small>Paste it into your calendar app under “Add calendar from URL”. Anyone with this address can see these dates, so keep it to yourself.</small>
            </div>
          )}
          <form action={rotateCalendarFeed} className="form-actions" style={{ marginTop: 16 }}>
            {feedUrl && (
              <a className="btn primary" href={feedUrl}>
                Subscribe
              </a>
            )}
            <button type="submit" className={feedUrl ? "btn" : "btn primary"}>
              {feedUrl ? "Replace the address" : "Create my calendar address"}
            </button>
          </form>
        </section>
        <section className="panel pad">
          <h2 className="rail-title">Booked means both said yes</h2>
          <p className="small muted">A proposed time is only an invitation. Neither person’s email address is shared; you both get a notice from Alumni Connect.</p>
        </section>
      </aside>
    </div>
  );
}

export default function MeetingsPage({ searchParams }: PageProps<"/meetings">) {
  return (
    <>
      <PageTitle eyebrow="Relationships / Meetings" title="Times you’ve agreed to meet." description="Propose a time to another member. It’s booked only when they accept." />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Meetings searchParams={searchParams} />
      </Suspense>
    </>
  );
}
