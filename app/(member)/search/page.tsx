import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoSubmit } from "@/components/auto-submit";
import { RememberSearch } from "@/components/back-to-search";
import { Icon } from "@/components/icon";
import { EmptyState, OPEN_TO_LABELS, PageTitle, PersonRow, type PersonSummary } from "@/components/person";
import { getAi } from "@/lib/ai";
import { groupCues, linkedinUrls, savedIds } from "@/lib/people";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { type ActiveFilters, DEFAULT_RADIUS, filterChips, type FilterNames, preferenceRecovery, radiusChoices, type SearchRecovery } from "@/lib/search/filters";
import { parseSearchText } from "@/lib/search/parse-query";
import { getVocabulary } from "@/lib/search/vocabulary";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Search" };

const PAGE_SIZE = 10;

type SearchParams = Record<string, string | string[] | undefined>;

interface FacetRow {
  count: number;
  confirmed: number;
  unconfirmed: number;
}
interface Facets {
  total: number;
  confirmed: number;
  unconfirmed: number;
  by_sector: (FacetRow & { slug: string; name: string })[];
  by_metro: (FacetRow & { metro: string })[];
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const toInt = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
const searchText = (params: SearchParams) => first(params.q).slice(0, 200);

function hrefWith(params: SearchParams, changes: Record<string, string | null>) {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const v of all(value)) url.append(key, v);
  for (const [key, value] of Object.entries(changes)) {
    url.delete(key);
    if (value !== null) url.set(key, value);
  }
  return `/search?${url.toString()}`;
}

async function SearchFilters({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { industries, places, groups, vocab } = await getVocabulary();
  const sectors = industries.filter((i) => i.parent_id === null);
  const q = searchText(params);
  const radius = radiusChoices(q ? parseSearchText(q, vocab).query.radiusMiles : null, toInt(first(params.radius)));

  return (
    // Keyed by the URL: the fields are uncontrolled, so a link that changes the
    // filters would otherwise leave them showing (and resubmitting) the old search.
    <form key={hrefWith(params, {})} id="search-form" action="/search" role="search">
      <label className="search-label" htmlFor="query">
        Search the alumni network
      </label>
      <div className="search-box">
        <Icon name="search" />
        <input id="query" name="q" defaultValue={first(params.q)} placeholder="Industry, city, name, class year, or goal" />
        <button type="submit" className="btn primary">
          Search alumni
        </button>
      </div>
      <div className="filter-row">
        <label className="sr-only" htmlFor="industry">
          Industry
        </label>
        <select id="industry" name="industry" defaultValue={first(params.industry)}>
          <option value="">All industries</option>
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
        <label className="sr-only" htmlFor="place">
          City
        </label>
        <select id="place" name="place" defaultValue={first(params.place)}>
          <option value="">All cities</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.state}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="radius">
          Radius
        </label>
        <select id="radius" name="radius" defaultValue={radius.defaultValue}>
          {radius.options.map(({ value, label }) => (
            <option key={label} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="from">
          Class from
        </label>
        <input id="from" name="from" type="number" min={1940} max={2035} placeholder="Class from" defaultValue={first(params.from)} style={{ width: 128 }} />
        <label className="sr-only" htmlFor="to">
          Class to
        </label>
        <input id="to" name="to" type="number" min={1940} max={2035} placeholder="Class to" defaultValue={first(params.to)} style={{ width: 128 }} />
        <label className="sr-only" htmlFor="open">
          Open to
        </label>
        <select id="open" name="open" defaultValue={first(params.open)}>
          <option value="">Any openness</option>
          {Object.entries(OPEN_TO_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {groups.length > 0 && (
          <>
            <label className="sr-only" htmlFor="group">
              Group
            </label>
            <select id="group" name="group" defaultValue={first(params.group)}>
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="checkbox">
          <input type="checkbox" name="confirmed" value="1" defaultChecked={first(params.confirmed) === "1"} />
          Confirmed only
        </label>
        <Link className="btn quiet" href="/search">
          Clear filters
        </Link>
      </div>
      <AutoSubmit formId="search-form" />
    </form>
  );
}

async function SearchResults({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireMember("/search");
  const params = await searchParams;
  const supabase = await createClient();
  const { industries, places, groups, vocab } = await getVocabulary();

  // Free text → filters: rules first, a model only when the rules recognize nothing.
  const q = searchText(params);
  let parsed = q ? parseSearchText(q, vocab) : null;
  if (parsed?.needsModel && getAi().config.mode !== "fixture") {
    const query = await getAi().parseSearchQuery(q, vocab);
    const place = places.find((p) => p.name === query.city && p.state === query.state);
    parsed = { query, placeId: place?.id ?? null, needsModel: false };
  }

  // Explicit filters win over what was parsed from the text.
  const industrySlugs = all(params.industry).length ? all(params.industry) : (parsed?.query.industrySlugs ?? []);
  const placeId = toInt(first(params.place)) ?? parsed?.placeId ?? null;
  const radius = toInt(first(params.radius)) ?? parsed?.query.radiusMiles ?? DEFAULT_RADIUS;
  const gradFrom = toInt(first(params.from)) ?? parsed?.query.gradYearMin ?? null;
  const gradTo = toInt(first(params.to)) ?? parsed?.query.gradYearMax ?? null;
  const openTo = all(params.open).length ? all(params.open) : (parsed?.query.openTo ?? []);
  const confirmedOnly = first(params.confirmed) === "1";
  const groupSlug = first(params.group) || null;
  const page = Math.max(1, toInt(first(params.page)) ?? 1);

  const limit = await checkRateLimit("search", viewer.userId, LIMITS.search);
  if (!limit.allowed) {
    return (
      <div className="notice error" role="alert">
        <Icon name="info" />
        <div>You’re searching very quickly. Wait a minute, then try again. Your filters have been kept.</div>
      </div>
    );
  }

  const filters = {
    p_text: parsed ? parsed.query.text : null,
    p_industry_slugs: industrySlugs.length ? industrySlugs : null,
    p_place_id: placeId,
    p_radius_miles: radius,
    p_grad_year_min: gradFrom,
    p_grad_year_max: gradTo,
    p_open_to: openTo.length ? openTo : null,
    p_confirmed_only: confirmedOnly,
    p_group_slug: groupSlug,
  };
  const [results, facets] = await Promise.all([
    supabase.rpc("search_people", { ...filters, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    supabase.rpc("search_facets", filters),
  ]);
  if (results.error) throw results.error;
  if (facets.error) throw facets.error;

  const people = (results.data ?? []) as PersonSummary[];
  const f = facets.data as Facets;
  const ids = people.map((p) => p.id);
  const [saved, cues, linkedin] = await Promise.all([savedIds(supabase, viewer.userId, ids), groupCues(supabase, ids), linkedinUrls(supabase, ids)]);
  const totalPages = Math.max(1, Math.ceil(f.total / PAGE_SIZE));

  const place = places.find((p) => p.id === placeId);
  const active: ActiveFilters = {
    text: parsed?.query.text ?? null,
    industrySlugs,
    placeId,
    radius,
    gradFrom,
    gradTo,
    openTo,
    groupSlug,
    confirmedOnly,
  };
  const names: FilterNames = {
    industry: (slug) => industries.find((i) => i.slug === slug)?.name ?? slug,
    place: place ?? null,
    group: groups.find((g) => g.slug === groupSlug)?.name ?? null,
  };
  const chips = filterChips(active, names);

  // A preference that empties the results: count the same search without it, to
  // tell a market nobody has opted into yet apart from one with nobody in it.
  let recovery: SearchRecovery | null = null;
  if (f.total === 0 && openTo.length) {
    const broader = await supabase.rpc("search_facets", { ...filters, p_open_to: null });
    if (broader.error) throw broader.error;
    recovery = preferenceRecovery(active, names, (broader.data as Facets).total);
  }

  const breakdown = (title: string, rows: { key: string; label: string; row: FacetRow }[]) => (
    <>
      <h3 className="small" style={{ marginTop: 24 }}>
        {title}
      </h3>
      {rows.length ? (
        rows.map(({ key, label, row }) => (
          <div key={key} className="detail-row">
            <strong className="small">{label}</strong>
            <span className="meta">
              {row.confirmed} confirmed · {row.unconfirmed} unconfirmed
            </span>
          </div>
        ))
      ) : (
        <p className="small muted">No matching records</p>
      )}
    </>
  );

  return (
    <>
      {chips.length > 0 && (
        <div className="filter-chips" role="group" aria-labelledby="interpreted-filters">
          <span id="interpreted-filters" className="meta">
            Interpreted filters
          </span>
          {chips.map((chip) => (
            // No prefetch: each chip is a full search, counted against the rate limit.
            <Link key={chip.key} className="filter-chip" href={chip.href} prefetch={false} aria-label={`Remove filter: ${chip.label}`}>
              {chip.label}
              <Icon name="close" />
            </Link>
          ))}
        </div>
      )}
      <div className="split" style={{ marginTop: chips.length ? 0 : 24 }}>
        <section className="panel">
          <div className="section-head pad" style={{ margin: 0 }}>
            <h2 id="result-count">
              {f.total} {f.total === 1 ? "alumnus" : "alumni"}
            </h2>
          </div>
          {people.length ? (
            <>
              {people.map((person) => (
                <PersonRow key={person.id} person={person} saved={saved.has(person.id)} cue={cues.get(person.id)} linkedin={linkedin.get(person.id)} />
              ))}
              <div className="pagination">
                <span>
                  {f.confirmed} confirmed · {f.unconfirmed} unconfirmed records
                </span>
                <div className="od-cluster">
                  {page > 1 ? (
                    <Link className="btn" href={hrefWith(params, { page: String(page - 1) })}>
                      Previous
                    </Link>
                  ) : (
                    <button type="button" className="btn" disabled>
                      Previous
                    </button>
                  )}
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  {page < totalPages ? (
                    <Link className="btn" href={hrefWith(params, { page: String(page + 1) })}>
                      Next
                    </Link>
                  ) : (
                    <button type="button" className="btn" disabled>
                      Next
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title={recovery?.title ?? "No matches yet"}
              text={recovery?.text ?? "Try a wider market, remove a filter, or search for a different specialty."}
              action={
                <Link className="btn primary" href={recovery?.href ?? "/search"} prefetch={false}>
                  {recovery?.actionLabel ?? "Clear filters"}
                </Link>
              }
            />
          )}
        </section>
        <aside className="stack right-rail">
          <section className="panel pad">
            <h2>Search breakdown</h2>
            {breakdown(
              "By industry",
              f.by_sector.map((s) => ({ key: s.slug, label: s.name, row: s })),
            )}
            {breakdown(
              "By metro",
              f.by_metro.map((m) => ({ key: m.metro, label: m.metro, row: m })),
            )}
          </section>
          <section className="panel pad">
            <h3>What does unconfirmed mean?</h3>
            <p className="small muted" style={{ marginTop: 12 }}>
              A profile assembled from public or licensed sources, before the alumnus has joined. It has not yet been
              claimed or checked by that person.
            </p>
            <p className="small muted" style={{ marginTop: 12 }}>
              Confirmed means the person has claimed and verified their profile. It does not imply university endorsement.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div className="panel" style={{ marginTop: 24 }} role="status" aria-label="Loading alumni">
      {[1, 2, 3].map((i) => (
        <div key={i} className="loading-row">
          <div className="skeleton big" />
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      ))}
      <p className="pad muted small">Finding relevant alumni…</p>
    </div>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <>
      <RememberSearch />
      <PageTitle
        eyebrow="Discover / Search"
        title="Find your people."
        description="Search by what you need. Refine by who, where, and how you’d like to connect."
      />
      <Suspense fallback={<div className="search-box" style={{ height: 62 }} />}>
        <SearchFilters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ResultsSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </>
  );
}
