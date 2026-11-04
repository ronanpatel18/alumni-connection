import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle, PersonRow } from "@/components/person";
import { Relevance } from "@/components/relevance";
import { groupCues, linkedinUrls, savedIds } from "@/lib/people";
import { GOALS, type Goal, isGoal, suggestionReasons, suggestions } from "@/lib/recommendations";
import { getVocabulary } from "@/lib/search/vocabulary";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Who to meet" };

const PAGE_LIMIT = 10;

async function Choices({ searchParams }: { searchParams: PageProps<"/discover/who-to-meet">["searchParams"] }) {
  const { goal, market } = await searchParams;
  const { places } = await getVocabulary();
  // A plain GET form: the choice lives in the URL, so a view can be bookmarked.
  return (
    <form className="panel pad" style={{ marginBottom: 24 }} method="get">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="goal">What are you working toward?</label>
          <select id="goal" name="goal" defaultValue={isGoal(goal) ? goal : "partners"}>
            {Object.entries(GOALS).map(([value, g]) => (
              <option key={value} value={value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="market">Preferred market</label>
          <select id="market" name="market" defaultValue={typeof market === "string" ? market : ""}>
            <option value="">Any market</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.state}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary">
          Update suggestions
        </button>
        <span className="chip ai">AI-assisted · Explainable suggestions</span>
      </div>
    </form>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/discover/who-to-meet">["searchParams"] }) {
  const viewer = await requireMember("/discover/who-to-meet");
  const params = await searchParams;
  const goal: Goal = isGoal(params.goal) ? params.goal : "partners";
  const { places } = await getVocabulary();
  const place = places.find((p) => String(p.id) === params.market) ?? null;
  const marketLabel = place ? `${place.name}, ${place.state}` : null;

  const supabase = await createClient();
  const list = await suggestions(supabase, viewer, { goal, placeId: place?.id ?? null, limit: PAGE_LIMIT });
  if (!list.length) {
    return (
      <EmptyState
        title={marketLabel ? `No suggestions near ${marketLabel} yet` : "No suggestions for this goal yet"}
        text="Choose a broader market or another goal. We won’t add unrelated people to fill the list."
        action={
          marketLabel ? (
            <Link className="btn primary" href={`/discover/who-to-meet?goal=${goal}`}>
              Broaden market
            </Link>
          ) : undefined
        }
      />
    );
  }

  const people = list.map((s) => s.person);
  const ids = people.map((p) => p.id);
  const reasons = suggestionReasons(supabase, viewer.userId, goal, marketLabel, people);
  const [saved, cues, linkedin] = await Promise.all([savedIds(supabase, viewer.userId, ids), groupCues(supabase, ids), linkedinUrls(supabase, ids)]);

  return (
    <div className="stack">
      {list.map(({ person, evidence }) => (
        <section key={person.id} className="panel suggestion">
          <PersonRow person={person} saved={saved.has(person.id)} cue={cues.get(person.id)} linkedin={linkedin.get(person.id)} />
          <div className="pad suggestion-why">
            <Suspense
              fallback={
                <p className="meta" role="status">
                  Writing why they may be relevant…
                </p>
              }
            >
              <Relevance
                reasons={reasons}
                personId={person.id}
                evidence={`Goal: ${GOALS[goal].phrase} · Evidence: ${evidence.join(", ") || "profile details"}`}
              />
            </Suspense>
          </div>
        </section>
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="panel" role="status" aria-label="Finding suggestions">
      {[1, 2, 3].map((i) => (
        <div key={i} className="loading-row">
          <div className="skeleton big" />
          <div className="skeleton" />
        </div>
      ))}
      <p className="pad muted small">Finding people worth meeting…</p>
    </div>
  );
}

export default function WhoToMeetPage({ searchParams }: PageProps<"/discover/who-to-meet">) {
  return (
    <>
      <PageTitle
        eyebrow="Discover / Who to meet"
        title="The right connection depends on your goal."
        description="Every suggestion explains its relevance. Change your goal to see a different starting point."
      />
      <Suspense fallback={<div className="panel pad" style={{ marginBottom: 24 }}><div className="skeleton" /></div>}>
        <Choices searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
      <p className="footnote">
        Suggestions use your goal, market and profile details such as role, industry and experience. They’re starting points, not
        endorsements or a ranking of anyone. Relevance lines are AI-written and can miss context.
      </p>
    </>
  );
}
