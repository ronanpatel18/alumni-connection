import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CommunityTabs } from "@/components/community-tabs";
import { Icon } from "@/components/icon";
import { LocalTime } from "@/components/local-time";
import { ResultNotice } from "@/components/notice";
import { EmptyState, PageTitle } from "@/components/person";
import { googleCalendarLink } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { cancelEvent, toggleRsvp } from "./actions";

export const metadata: Metadata = { title: "Events" };

const RESULTS = {
  posted: { text: "Your event is posted. Members can now say they’re going." },
  cancelled: { text: "The event is marked as cancelled." },
  error: { tone: "error" as const, text: "That couldn’t be saved. Refresh and try again." },
};

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  url: string | null;
  is_online: boolean;
  cancelled: boolean;
  host_name: string;
  host_person_id: string | null;
  is_mine: boolean;
  going: number;
  i_am_going: boolean;
}

const placeOf = (e: EventRow) => [e.city, e.state].filter(Boolean).join(", ");

async function Events({ searchParams }: { searchParams: PageProps<"/events">["searchParams"] }) {
  const viewer = await requireMember("/events");
  const { city, when, result } = await searchParams;
  const past = when === "past";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_list", { p_past: past });
  if (error) throw error;
  const all = (data ?? []) as EventRow[];
  const cities = [...new Set(all.map(placeOf).filter(Boolean))].sort();
  const chosen = typeof city === "string" ? city : "";
  const events = all.filter((e) => !chosen || (chosen === "online" ? e.is_online : placeOf(e) === chosen));

  return (
    <>
      <ResultNotice result={result} messages={RESULTS} />
      <form className="filter-row" action="/events" style={{ margin: "0 0 24px" }}>
        <select name="city" defaultValue={chosen} aria-label="City">
          <option value="">Every city</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="online">Online</option>
        </select>
        <select name="when" defaultValue={past ? "past" : ""} aria-label="When">
          <option value="">Upcoming</option>
          <option value="past">Past</option>
        </select>
        <button type="submit" className="btn">
          Show
        </button>
        <Link className="btn primary" href="/events/new" style={{ marginLeft: "auto" }}>
          <Icon name="plus" /> Post an event
        </Link>
      </form>
      {events.length === 0 ? (
        <section className="panel">
          <EmptyState
            title={past ? "No past events here" : chosen ? "Nothing coming up here yet" : "No events coming up yet"}
            text="A game watch, a coffee, a networking night: any member can post one, and others can say they’re going."
            action={
              <Link className="btn primary" href="/events/new">
                Post the first one
              </Link>
            }
          />
        </section>
      ) : (
        <section className="panel">
          <div className="detail-list">
            {events.map((e) => (
              <div key={e.id} className="detail-row" style={{ padding: 24 }}>
                <div className="od-cluster" style={{ justifyContent: "space-between" }}>
                  <h3>{e.title}</h3>
                  {e.cancelled ? <span className="chip">Cancelled</span> : e.i_am_going ? <span className="chip success"><Icon name="check" /> You’re going</span> : null}
                </div>
                <p className="small">
                  <Icon name="calendar" /> <LocalTime iso={e.starts_at} />
                  {e.ends_at && (
                    <>
                      {" – "}
                      <LocalTime iso={e.ends_at} />
                    </>
                  )}
                </p>
                <p className="small muted">
                  <Icon name="pin" /> {[e.venue, placeOf(e), e.is_online && "Online"].filter(Boolean).join(" · ") || "Location to be announced"}
                </p>
                {e.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{e.description}</p>}
                <p className="meta">
                  Hosted by {e.host_person_id ? <Link href={`/people/${e.host_person_id}`}>{e.host_name}</Link> : e.host_name} · {e.going} going
                </p>
                {!past && !e.cancelled && (
                  <div className="od-cluster">
                    <form action={toggleRsvp}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="going" value={String(e.i_am_going)} />
                      <button type="submit" className={e.i_am_going ? "btn" : "btn primary"}>
                        {e.i_am_going ? "I can’t go after all" : "I’m going"}
                      </button>
                    </form>
                    <a className="btn" href={`/events/${e.id}/calendar`}>
                      <Icon name="calendar" /> Calendar file
                    </a>
                    <a
                      className="btn quiet"
                      target="_blank"
                      rel="noreferrer noopener"
                      href={googleCalendarLink({ title: e.title, start: e.starts_at, end: e.ends_at, location: [e.venue, placeOf(e)].filter(Boolean).join(", "), description: e.description })}
                    >
                      Google Calendar
                    </a>
                    {e.url && (
                      <a className="btn quiet" href={e.url} target="_blank" rel="noreferrer noopener">
                        Details
                      </a>
                    )}
                    {(e.is_mine || viewer.isAdmin) && (
                      <form action={cancelEvent}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="btn quiet">
                          Cancel event
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function EventsPage({ searchParams }: PageProps<"/events">) {
  return (
    <>
      <PageTitle eyebrow="Community / Events" title="Meet Badgers where you are." description="Events posted by members, city by city. Say you’re going and it lands in your calendar feed." />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Events searchParams={searchParams} />
      </Suspense>
    </>
  );
}
