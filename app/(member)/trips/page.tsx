import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { createClient } from "@/lib/supabase/server";
import { type Trip, tripCity, tripDates } from "@/lib/trips";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Trips" };

type TripWithCount = Trip & { trip_shortlist: { count: number }[] };

async function TripList({ searchParams }: { searchParams: PageProps<"/trips">["searchParams"] }) {
  const viewer = await requireMember("/trips");
  const { deleted } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("trips")
    .select("id, place_id, starts_on, ends_on, industry_slugs, goal, created_at, places(name, state), trip_shortlist(count)")
    .eq("owner_user_id", viewer.userId)
    .order("starts_on", { ascending: true })
    .returns<TripWithCount[]>();
  const today = new Date().toISOString().slice(0, 10);
  const trips = data ?? [];
  const upcoming = trips.filter((t) => t.ends_on >= today);
  const past = trips.filter((t) => t.ends_on < today).reverse();

  const row = (t: TripWithCount, isUpcoming: boolean) => {
    const selected = t.trip_shortlist[0]?.count ?? 0;
    return (
      <article key={t.id} className="pad trip-row">
        <div className="od-cluster">
          <span className="chip">
            <Icon name="trip" />
            {isUpcoming ? "Upcoming trip" : "Past trip"}
          </span>
          <span className="meta">Private to you</span>
        </div>
        <h2 className="trip-city">
          <Link href={`/trips/${t.id}`}>{tripCity(t)}</Link>
        </h2>
        <p className="muted">{tripDates(t)}</p>
        {t.goal && <p className="trip-goal">{t.goal}</p>}
        <div className="form-actions">
          <Link className={`btn${isUpcoming ? " primary" : ""}`} href={`/trips/${t.id}`}>
            View your shortlist
          </Link>
          <Link className="btn quiet" href={`/trips/${t.id}/edit`}>
            Edit trip
          </Link>
        </div>
        <p className="meta" style={{ marginTop: 16 }}>
          {selected} {selected === 1 ? "person" : "people"} selected · No messages sent automatically
        </p>
      </article>
    );
  };

  return (
    <>
      {deleted === "1" && (
        <div className="notice success" role="status" style={{ marginBottom: 24 }}>
          <Icon name="check" />
          <div>Trip deleted, with its shortlist and drafts.</div>
        </div>
      )}
      <div className="split">
        <section className="panel">
          {trips.length === 0 ? (
            <EmptyState
              title="Where are you headed?"
              text="Find alumni in your destination, choose a few people worth meeting, and make time for a conversation."
              action={
                <Link className="btn primary" href="/trips/new">
                  Plan your first trip
                </Link>
              }
            />
          ) : (
            <div className="trip-list">
              {upcoming.map((t) => row(t, true))}
              {past.length > 0 && <h2 className="pad trip-section">Past trips</h2>}
              {past.map((t) => row(t, false))}
            </div>
          )}
        </section>
        <aside className="right-rail stack">
          <section className="trip-callout">
            <div className="eyebrow">A little preparation. A warmer hello.</div>
            <h2>
              Make the trip
              <br />
              more personal.
            </h2>
            <p>Suggestions consider your destination, industries and goal. Every draft is yours to review.</p>
          </section>
          <section className="panel pad">
            <h3>Respect their time</h3>
            <p className="small muted" style={{ marginTop: 12 }}>
              Start with a short, specific invitation. Choose a few relevant people rather than writing to everyone.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function TripsPage({ searchParams }: PageProps<"/trips">) {
  return (
    <>
      <PageTitle
        eyebrow="Trips"
        title="A familiar face in a new city."
        description="Build a thoughtful meeting plan before you pack your bag."
        action={
          <Link className="btn primary" href="/trips/new">
            <Icon name="plus" /> Plan a trip
          </Link>
        }
      />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <TripList searchParams={searchParams} />
      </Suspense>
    </>
  );
}
