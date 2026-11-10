import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { Relevance } from "@/components/relevance";
import { EmptyState, PersonRow } from "@/components/person";
import { TripSteps } from "@/components/trip-steps";
import { groupCues, linkedinUrls, savedIds } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { loadTrip, shortlistIds, tripCandidates, tripCity, tripDates, tripRelevance } from "@/lib/trips";
import { requireMember } from "@/lib/viewer";
import { toggleShortlist } from "../actions";

export const metadata: Metadata = { title: "Trip shortlist" };

async function Shortlist({ params }: { params: PageProps<"/trips/[id]">["params"] }) {
  const { id } = await params;
  const viewer = await requireMember(`/trips/${id}`);
  const supabase = await createClient();
  const trip = await loadTrip(supabase, id);
  if (!trip) notFound();

  const people = await tripCandidates(supabase, trip);
  const ids = people.map((p) => p.id);
  // Relevance lines can take a while (AI), so they stream in after the list.
  const reasons = tripRelevance(supabase, viewer.userId, trip, people);
  const [selected, saved, cues, linkedin] = await Promise.all([
    shortlistIds(supabase, trip.id),
    savedIds(supabase, viewer.userId, ids),
    groupCues(supabase, ids),
    linkedinUrls(supabase, ids),
  ]);
  // The shortlist can include people from before the trip was edited.
  const { data: chosen } = selected.size
    ? await supabase
        .from("people")
        .select("id, full_name, current_title, organizations:current_organization_id(name)")
        .in("id", [...selected])
        .returns<{ id: string; full_name: string; current_title: string | null; organizations: { name: string } | null }[]>()
    : { data: [] };

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">Trips / Your shortlist</div>
          <h1>A few people. Better conversations.</h1>
          <p>
            {tripCity(trip)} · {tripDates(trip)}
          </p>
        </div>
        <Link className="btn" href={`/trips/${trip.id}/edit`}>
          Edit trip
        </Link>
      </div>
      <TripSteps current={1} />
      <div className="split">
        <section className="stack">
          {trip.goal && (
            <div className="notice">
              <Icon name="info" />
              <div>
                <strong>Your goal</strong>
                <p>{trip.goal}</p>
              </div>
            </div>
          )}
          <div className={people.length === 0 ? "panel" : "person-cards"}>
            {people.length === 0 ? (
              <EmptyState
                title="No matches for this visit yet"
                text="Try another industry or a nearby city. We won’t add unrelated people to fill your list."
                action={
                  <Link className="btn primary" href={`/trips/${trip.id}/edit`}>
                    Edit trip
                  </Link>
                }
              />
            ) : (
              people.map((person) => {
                const isSelected = selected.has(person.id);
                return (
                  <article key={person.id} className="trip-candidate">
                    <PersonRow person={person} saved={saved.has(person.id)} cue={cues.get(person.id)} linkedin={linkedin.get(person.id)} />
                    <div className="pad trip-relevance">
                      <Suspense
                        fallback={
                          <p className="meta" role="status">
                            Writing why they may be relevant…
                          </p>
                        }
                      >
                        <Relevance reasons={reasons} personId={person.id} />
                      </Suspense>
                      <form action={toggleShortlist}>
                        <input type="hidden" name="trip_id" value={trip.id} />
                        <input type="hidden" name="person_id" value={person.id} />
                        <input type="hidden" name="selected" value={String(isSelected)} />
                        <button type="submit" className="btn" aria-pressed={isSelected}>
                          {isSelected ? (
                            <>
                              <Icon name="check" /> On your shortlist
                            </>
                          ) : (
                            "Add to shortlist"
                          )}
                          <span className="sr-only"> ({person.full_name})</span>
                        </button>
                      </form>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          {people.length > 0 && (
            <p className="footnote">
              Alumni within 50 miles of {trip.places?.name ?? "your destination"} in the industries you chose. Relevance lines are AI-written
              from profile details and can miss context.
            </p>
          )}
        </section>
        <aside className="right-rail stack">
          <section className="panel pad">
            <h2 className="rail-title">Your meeting shortlist</h2>
            {chosen?.length ? (
              <>
                <div className="detail-list">
                  {chosen.map((p) => (
                    <div key={p.id} className="detail-row">
                      <strong className="small">{p.full_name}</strong>
                      <span className="meta">{[p.current_title, p.organizations?.name].filter(Boolean).join(" · ")}</span>
                      <Link className="btn quiet" style={{ justifySelf: "start", paddingInline: 0 }} href={`/trips/${trip.id}/outreach/${p.id}`}>
                        Draft an invitation <Icon name="arrow" />
                      </Link>
                    </div>
                  ))}
                </div>
                <p className="meta" style={{ marginTop: 16 }}>
                  {chosen.length} selected · Messages are written one at a time
                </p>
              </>
            ) : (
              <p className="small muted">Add a few relevant alumni. Your shortlist stays private until you choose to reach out.</p>
            )}
          </section>
          <section className="panel pad">
            <h3>One conversation at a time</h3>
            <p className="small muted" style={{ marginTop: 12 }}>
              Review and personalize each message. A shortlist doesn’t notify anyone or guarantee they’re available.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function TripShortlistPage({ params }: PageProps<"/trips/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="panel pad" role="status" aria-label="Finding people for your trip">
          <div className="skeleton big" />
          <div className="skeleton" />
          <div className="skeleton short" />
          <p className="small muted">Finding people for your trip…</p>
        </div>
      }
    >
      <Shortlist params={params} />
    </Suspense>
  );
}
