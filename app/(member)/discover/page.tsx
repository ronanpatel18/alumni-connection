import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { SuggestionRow } from "@/components/suggestion-row";
import { groupCues, linkedinUrls, savedIds } from "@/lib/people";
import { GOALS, suggestionReasons, suggestions } from "@/lib/recommendations";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Discover" };

const SEARCH_HINTS = ["Real estate in Chicago", "Finance in New York", "Technology in Seattle"];
const DEFAULT_GOAL = "partners" as const;

/** A few starting points ranked for the member's goal, each with its reason. */
async function StartingPoints() {
  const viewer = await requireMember("/discover");
  const supabase = await createClient();
  const list = await suggestions(supabase, viewer, { goal: DEFAULT_GOAL, placeId: null, limit: 3 });
  if (!list.length) {
    return <EmptyState title="No profiles yet" text="Import a roster or a board listing to start the directory." />;
  }
  const people = list.map((s) => s.person);
  const ids = people.map((p) => p.id);
  const reasons = suggestionReasons(supabase, viewer.userId, DEFAULT_GOAL, null, people);
  const [saved, cues, linkedin] = await Promise.all([savedIds(supabase, viewer.userId, ids), groupCues(supabase, ids), linkedinUrls(supabase, ids)]);
  return (
    <>
      {list.map((suggestion) => {
        const { id } = suggestion.person;
        return (
          <div key={id} className="suggestion">
            <SuggestionRow suggestion={suggestion} saved={saved.has(id)} cue={cues.get(id)} linkedin={linkedin.get(id)} reasons={reasons} />
          </div>
        );
      })}
    </>
  );
}

async function SavedSummary() {
  const viewer = await requireMember("/discover");
  const supabase = await createClient();
  const { count } = await supabase.from("saved_contacts").select("person_id", { count: "exact", head: true }).eq("owner_user_id", viewer.userId);
  return (
    <strong className="small">
      {count ?? 0} saved contact{count === 1 ? "" : "s"}
    </strong>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading alumni">
      {[1, 2, 3].map((i) => (
        <div key={i} className="loading-row">
          <div className="skeleton big" />
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      ))}
      <p className="pad muted small">Finding alumni…</p>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <>
      <PageTitle
        eyebrow="A Wisconsin beginning. A nationwide network."
        title="Good connections start here."
        description="Find the people, shared experiences, and warm introductions that move you forward."
      />
      <div className="split">
        <div className="stack">
          <section aria-labelledby="search-label">
            <label className="search-label" id="search-label" htmlFor="discovery-search">
              Who would you like to connect with?
            </label>
            <form className="search-box" action="/search" role="search">
              <Icon name="search" />
              <input id="discovery-search" name="q" placeholder="Try “commercial real estate in Chicago”" autoComplete="off" />
              <button type="submit" className="btn primary">
                Find alumni <Icon name="arrow" />
              </button>
            </form>
            <div className="search-hints">
              <span>Try a search:</span>
              {SEARCH_HINTS.map((q) => (
                <Link key={q} href={`/search?q=${encodeURIComponent(q)}`} style={{ color: "var(--muted)" }}>
                  {q}
                </Link>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="pad" style={{ paddingBottom: 0 }}>
              <div className="section-head">
                <div>
                  <h2>People worth knowing</h2>
                  <p className="small muted">A few starting points, based on a professional goal.</p>
                </div>
                <Link className="btn quiet" href="/discover/who-to-meet">
                  See all <Icon name="arrow" />
                </Link>
              </div>
              <div className="od-cluster small muted" style={{ paddingBottom: 20 }}>
                <span className="chip ai">AI-assisted suggestions</span>
                <span>Goal: {GOALS[DEFAULT_GOAL].phrase}</span>
                <Link href="/discover/who-to-meet">Change goal</Link>
              </div>
            </div>
            <Suspense fallback={<Skeleton />}>
              <StartingPoints />
            </Suspense>
          </section>

          <div className="notice">
            <Icon name="lock" />
            <div>
              <strong>A members-only network.</strong>
              <p className="small muted">
                Contact details are visible to verified members only. Introductions always ask both sides first.
              </p>
            </div>
          </div>
        </div>

        <aside className="right-rail stack">
          <section className="panel pad">
            <h2 className="rail-title">Keep the conversation going</h2>
            <div className="rail-list">
              <Link className="rail-link" href="/saved">
                <Icon name="save" />
                <div>
                  <Suspense fallback={<strong className="small">Saved contacts</strong>}>
                    <SavedSummary />
                  </Suspense>
                  <p>Pick up where you left off.</p>
                </div>
              </Link>
              <Link className="rail-link" href="/search">
                <Icon name="chart" />
                <div>
                  <strong className="small">Explore the network</strong>
                  <p>See alumni by market and industry.</p>
                </div>
              </Link>
            </div>
          </section>
          <section className="trip-callout">
            <div className="eyebrow">Traveling soon?</div>
            <h2>Make the trip more personal.</h2>
            <p>Find alumni in your destination, choose a few worth meeting, and start one thoughtful conversation at a time.</p>
            <Link className="btn primary" href="/trips/new">
              Plan a trip <Icon name="arrow" />
            </Link>
          </section>
          <p className="footnote">
            Early access: profiles start from the Wisconsin School of Business advisory boards and public sources.
          </p>
        </aside>
      </div>
    </>
  );
}
