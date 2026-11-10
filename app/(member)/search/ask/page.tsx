import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RememberSearch } from "@/components/back-to-search";
import { Icon } from "@/components/icon";
import { EmptyState, isConfirmed, OPEN_TO_LABELS, PageTitle, PersonRow } from "@/components/person";
import { SearchModeTabs } from "@/components/search-mode-tabs";
import { SENIORITY_LABELS } from "@/lib/labels";
import { groupCues, linkedinUrls, savedIds } from "@/lib/people";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { ASK_MAX_LENGTH, type AskFilters, type AskParams, askChips, askEvidence, askHref, askText, effectiveFilters } from "@/lib/search/ask";
import { type AskPerson, type Ranking, rankShortlist, resolveIntent, shortlist } from "@/lib/search/ask-server";
import { getVocabulary } from "@/lib/search/vocabulary";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Describe who you want to meet" };

const VISIBLE = 10;
const EXAMPLES = [
  "I’m moving to Chicago and want to meet people in commercial real estate who mentor",
  "Founders or executives in health care I could ask about starting a company",
  "Investors in Milwaukee from the classes of the 1990s",
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function AskForm({ searchParams }: { searchParams: Promise<AskParams> }) {
  const ask = askText(await searchParams);
  return (
    // Keyed by the request, so following an example link refills the box.
    <form key={ask} action="/search/ask" role="search" className="panel pad">
      <div className="field">
        <label htmlFor="ask">Who would you like to meet, and why?</label>
        <textarea
          id="ask"
          name="ask"
          defaultValue={ask}
          maxLength={ASK_MAX_LENGTH}
          rows={3}
          style={{ minHeight: 96 }}
          required
          placeholder="For example: I’m moving to Austin and want to break into climate tech venture capital, ideally someone from the 2010s who mentors."
          aria-describedby="ask-help"
        />
        <small id="ask-help">Mention a city, field, class years or what you hope to learn. You can correct what was understood afterwards.</small>
      </div>
      <div className="form-actions" style={{ marginTop: 16 }}>
        <button type="submit" className="btn primary">
          Find people
        </button>
        <span className="chip ai">AI-assisted · Explainable suggestions</span>
      </div>
    </form>
  );
}

function Examples() {
  return (
    <div className="panel">
      <div className="empty">
        <Icon name="search" />
        <h2>Start with what you’re working toward</h2>
        <p>Describe the person in your own words. You’ll get a short list, each with the facts it rests on and a reason.</p>
        <div className="od-stack" style={{ ["--od-gap" as string]: "8px", justifyItems: "center" }}>
          {EXAMPLES.map((example) => (
            <Link key={example} className="small" href={`/search/ask?${new URLSearchParams({ ask: example })}`} prefetch={false}>
              “{example}”
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ListProps {
  people: AskPerson[];
  filters: AskFilters;
  saved: Set<string>;
  cues: Map<string, string>;
  linkedin: Map<string, string>;
  showAll: boolean;
  moreHref: string;
}

/** The suggestions in a given order. `ranking` is null while the AI is still ordering them. */
function SuggestionList({ people, filters, saved, cues, linkedin, showAll, moreHref, ranking }: ListProps & { ranking: Ranking | null }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const inOrder = ranking ? ranking.order.flatMap((id) => byId.get(id) ?? []) : people;
  // People the AI gave a reason for lead; the rest keep their order below them.
  const withReason = ranking ? inOrder.filter((p) => ranking.reasons.has(p.id)) : [];
  const ordered = ranking ? [...withReason, ...inOrder.filter((p) => !ranking.reasons.has(p.id))] : inOrder;
  const visible = showAll ? ordered : ordered.slice(0, VISIBLE);
  const status = !ranking
    ? null
    : !ranking.aiOrdered
      ? "AI reasons aren’t available right now, so these are the closest matches to your filters and keywords."
      : withReason.length === 0
        ? "The AI didn’t find anyone who clearly fits your request, so no reasons are shown. These are the closest matches to your filters and keywords."
        : withReason.length < ordered.length
          ? `Ordered for your request. The first ${withReason.length === 1 ? "person has a reason" : `${withReason.length} have reasons`} AI-written from their own profile details; the rest matched your filters or description less directly.`
          : "Ordered for your request. Reasons are AI-written from each profile’s own details.";
  return (
    <>
      {status && (
        <p className="meta" role="status" style={{ marginBottom: 12 }}>
          {status}
        </p>
      )}
      <div className="stack">
        {visible.map((person) => {
          const evidence = askEvidence(person, filters);
          const why = ranking?.reasons.get(person.id);
          return (
            <section key={person.id} className="panel suggestion">
              <PersonRow person={person} saved={saved.has(person.id)} cue={cues.get(person.id)} linkedin={linkedin.get(person.id)} />
              <div className="pad suggestion-why">
                {evidence.length > 0 && <p className="meta">{evidence.join(" · ")}</p>}
                {ranking === null ? (
                  <p className="meta" role="status">
                    Writing why they may be relevant…
                  </p>
                ) : (
                  why && (
                    <>
                      <span className="chip ai">AI-generated relevance</span>
                      <p className="small">{why}</p>
                    </>
                  )
                )}
              </div>
            </section>
          );
        })}
      </div>
      {!showAll && ordered.length > VISIBLE && (
        <div className="form-actions">
          <Link className="btn" href={moreHref} prefetch={false}>
            Show all {ordered.length} suggestions
          </Link>
        </div>
      )}
    </>
  );
}

async function RankedList({ ranking, ...list }: ListProps & { ranking: Promise<Ranking> }) {
  return <SuggestionList {...list} ranking={await ranking} />;
}

function AdjustFilters({ ask, filters, places, industries }: { ask: string; filters: AskFilters; places: { id: number; name: string; state: string }[]; industries: { id: number; slug: string; name: string; parent_id: number | null }[] }) {
  const sectors = industries.filter((i) => i.parent_id === null);
  return (
    <details style={{ marginBottom: 24 }}>
      <summary>Adjust what was understood</summary>
      <form action="/search/ask" className="filter-row" style={{ marginTop: 16 }}>
        <input type="hidden" name="ask" value={ask} />
        <input type="hidden" name="edited" value="1" />
        {/* Extra values beyond the first stay applied; remove them with their chips. */}
        {filters.industrySlugs.slice(1).map((slug) => (
          <input key={slug} type="hidden" name="industry" value={slug} />
        ))}
        {filters.openTo.slice(1).map((value) => (
          <input key={value} type="hidden" name="open" value={value} />
        ))}
        {filters.seniority.slice(1).map((value) => (
          <input key={value} type="hidden" name="level" value={value} />
        ))}
        <label className="sr-only" htmlFor="ask-place">
          City
        </label>
        <select id="ask-place" name="place" defaultValue={filters.placeId ?? ""}>
          <option value="">Any city</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.state}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ask-radius">
          Radius
        </label>
        <select id="ask-radius" name="radius" defaultValue={String(filters.radius)}>
          {[...new Set([10, 25, 50, 100, 250, filters.radius])]
            .sort((a, b) => a - b)
            .map((miles) => (
              <option key={miles} value={miles}>
                {miles} miles
              </option>
            ))}
        </select>
        <label className="sr-only" htmlFor="ask-industry">
          Industry
        </label>
        <select id="ask-industry" name="industry" defaultValue={filters.industrySlugs[0] ?? ""}>
          <option value="">Any industry</option>
          {sectors.map((sector) => (
            <optgroup key={sector.id} label={sector.name}>
              <option value={sector.slug}>All of {sector.name}</option>
              {industries
                .filter((i) => i.parent_id === sector.id)
                .map((i) => (
                  <option key={i.id} value={i.slug}>
                    {i.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <label className="sr-only" htmlFor="ask-from">
          Class from
        </label>
        <input id="ask-from" name="from" type="number" min={1940} max={2035} placeholder="Class from" defaultValue={filters.gradFrom ?? ""} style={{ width: 128 }} />
        <label className="sr-only" htmlFor="ask-to">
          Class to
        </label>
        <input id="ask-to" name="to" type="number" min={1940} max={2035} placeholder="Class to" defaultValue={filters.gradTo ?? ""} style={{ width: 128 }} />
        <label className="sr-only" htmlFor="ask-open">
          Open to
        </label>
        <select id="ask-open" name="open" defaultValue={filters.openTo[0] ?? ""}>
          <option value="">Any openness</option>
          {Object.entries(OPEN_TO_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ask-level">
          Career level
        </label>
        <select id="ask-level" name="level" defaultValue={filters.seniority[0] ?? ""}>
          <option value="">Any level</option>
          {Object.entries(SENIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" name="confirmed" value="1" defaultChecked={filters.confirmedOnly} />
          Confirmed only
        </label>
        <button type="submit" className="btn">
          Update suggestions
        </button>
      </form>
    </details>
  );
}

async function AskResults({ searchParams }: { searchParams: Promise<AskParams> }) {
  const viewer = await requireMember("/search/ask");
  const params = await searchParams;
  const ask = askText(params);
  if (!ask) return <Examples />;

  const limit = await checkRateLimit("search", viewer.userId, LIMITS.search);
  if (!limit.allowed) {
    return (
      <div className="notice error" role="alert">
        <Icon name="info" />
        <div>You’re searching very quickly. Wait a minute, then try again. Your request has been kept.</div>
      </div>
    );
  }

  const supabase = await createClient();
  const { industries, places, vocab } = await getVocabulary();
  const intent = await resolveIntent(supabase, viewer.userId, ask, vocab);
  const filters = effectiveFilters(params, intent.parsed, intent.placeId);
  const place = places.find((p) => p.id === filters.placeId) ?? null;
  const chips = askChips(ask, filters, { industry: (slug) => industries.find((i) => i.slug === slug)?.name ?? slug, place });

  const people = await shortlist(supabase, intent, filters, viewer.personId);
  const understood = (
    <>
      <div className="filter-chips" role="group" aria-labelledby="understood-filters" style={{ marginTop: 24 }}>
        <span id="understood-filters" className="meta">
          {intent.source === "ai" ? "What we understood" : "Matched from your words"}
        </span>
        {chips.map((chip) => (
          <Link key={chip.key} className="filter-chip" href={chip.href} prefetch={false} aria-label={`Remove filter: ${chip.label}`}>
            {chip.label}
            <Icon name="close" />
          </Link>
        ))}
        {chips.length === 0 && <span className="small muted">No specific filters; matching on your description.</span>}
      </div>
      {intent.source === "rules" && (
        <p className="meta" style={{ marginBottom: 12 }}>
          Read with keyword rules rather than AI, so check the filters match what you meant.
        </p>
      )}
      <AdjustFilters ask={ask} filters={filters} places={places} industries={industries} />
    </>
  );

  if (!people.length) {
    return (
      <>
        {understood}
        <div className="panel">
          <EmptyState
            title={place ? `No one near ${place.name} fits yet` : "No one fits that description yet"}
            text={
              place
                ? "Location is applied strictly. Try the whole network, a wider radius, or remove a filter above. We won’t add unrelated people to fill the list."
                : "Remove a filter above or describe the person differently. We won’t add unrelated people to fill the list."
            }
            action={
              place ? (
                <Link className="btn primary" href={askHref(ask, filters, { placeId: null })} prefetch={false}>
                  Search every city
                </Link>
              ) : (
                <Link className="btn primary" href="/search">
                  Search and filter instead
                </Link>
              )
            }
          />
        </div>
      </>
    );
  }

  const ids = people.map((p) => p.id);
  // Not awaited: the list shows now, and the AI's order and reasons stream in.
  const ranking = rankShortlist(supabase, viewer.userId, ask, people);
  const [saved, cues, linkedin] = await Promise.all([savedIds(supabase, viewer.userId, ids), groupCues(supabase, ids), linkedinUrls(supabase, ids)]);
  const confirmed = people.filter((p) => isConfirmed(p.status)).length;
  const showAll = first(params.all) === "1";
  const list: ListProps = { people, filters, saved, cues, linkedin, showAll, moreHref: `${askHref(ask, filters)}&all=1` };

  return (
    <>
      {understood}
      <div className="section-head">
        <h2>
          {people.length} suggested {people.length === 1 ? "alumnus" : "alumni"}
        </h2>
        <span className="meta">
          {confirmed} confirmed · {people.length - confirmed} unconfirmed
        </span>
      </div>
      <Suspense fallback={<SuggestionList {...list} ranking={null} />}>
        <RankedList {...list} ranking={ranking} />
      </Suspense>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div className="panel" style={{ marginTop: 24 }} role="status" aria-label="Finding suggestions">
      {[1, 2, 3].map((i) => (
        <div key={i} className="loading-row">
          <div className="skeleton big" />
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      ))}
      <p className="pad muted small">Reading your request and finding people…</p>
    </div>
  );
}

export default function AskPage({ searchParams }: PageProps<"/search/ask">) {
  return (
    <>
      <RememberSearch />
      <PageTitle
        eyebrow="People"
        title="Describe who you want to meet."
        description="Say what you’re working toward. Suggestions come with the facts they rest on and a reason, and you can correct anything that was misunderstood."
      />
      <SearchModeTabs current="ask" />
      <Suspense fallback={<div className="panel pad" style={{ height: 220 }} />}>
        <AskForm searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ResultsSkeleton />}>
        <AskResults searchParams={searchParams} />
      </Suspense>
      <p className="footnote">
        Suggestions use your request and profile details such as role, industry, location and class year. They’re starting points, not
        endorsements or a ranking of anyone. Relevance lines are AI-written and can miss context.
      </p>
    </>
  );
}
