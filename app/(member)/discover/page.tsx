import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle, PersonRow, type PersonSummary } from "@/components/person";
import { groupCues, savedIds } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Discover" };

const STARTING_GROUP = { slug: "wsb-external-advisory-board", name: "WSB External Advisory Board" };
const SEARCH_HINTS = ["Real estate in Chicago", "Finance in New York", "Technology in Seattle"];

async function StartingPoints() {
  const viewer = await requireMember("/discover");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_people", { p_group_slug: STARTING_GROUP.slug, p_limit: 3 });
  if (error) throw error;
  const people = (data ?? []) as PersonSummary[];
  const ids = people.map((p) => p.id);
  const [saved, cues] = await Promise.all([savedIds(supabase, viewer.userId, ids), groupCues(supabase, ids)]);

  if (!people.length) {
    return <EmptyState title="No profiles yet" text="Import a roster or a board listing to start the directory." />;
  }
  return (
    <>
      {people.map((person) => (
        <PersonRow key={person.id} person={person} saved={saved.has(person.id)} cue={cues.get(person.id)} />
      ))}
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
                  <p className="small muted">Starting with the Wisconsin School of Business advisory boards.</p>
                </div>
                <Link className="btn quiet" href={`/search?group=${STARTING_GROUP.slug}`}>
                  See all <Icon name="arrow" />
                </Link>
              </div>
            </div>
            <Suspense fallback={<Skeleton />}>
              <StartingPoints />
            </Suspense>
          </section>

          <div className="notice">
            <Icon name="lock" />
            <div>
              <strong>Your network. Your boundaries.</strong>
              <p className="small muted">
                Contact details follow each member’s privacy settings. Introductions always ask both sides first.
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
          <p className="footnote">
            Early access: profiles start from the Wisconsin School of Business advisory boards and public sources.
          </p>
        </aside>
      </div>
    </>
  );
}
