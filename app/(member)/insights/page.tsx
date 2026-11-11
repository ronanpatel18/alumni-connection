import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CommunityTabs } from "@/components/community-tabs";
import { AutoSubmit } from "@/components/auto-submit";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { getVocabulary } from "@/lib/search/vocabulary";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Network insights" };

interface Row {
  name: string;
  slug?: string;
  count: number;
  confirmed: number;
  unconfirmed: number;
}

interface Insights {
  total: number;
  confirmed: number;
  unconfirmed: number;
  by_market: Row[];
  no_market: number;
  by_sector: Row[];
  no_sector: number;
}

type Params = PageProps<"/insights">["searchParams"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Rows shown before "Show more" (the rest are usually one or two records each). */
const VISIBLE_ROWS = 10;

/** Bars use a solid confirmed segment and a patterned unconfirmed one, with explicit counts (DESIGN.md). */
function Chart({ title, rows, unknown, unknownLabel, max, hrefFor }: { title: string; rows: Row[]; unknown: number; unknownLabel: string; max: number; hrefFor: (r: Row) => string | null }) {
  const bar = (r: Row) => {
    const href = hrefFor(r);
    return (
      <div key={r.name}>
        <div className="bar-row">
          <span className="bar-label">{href ? <Link href={href}>{r.name}</Link> : r.name}</span>
          <div className="bar-track" role="img" aria-label={`${r.name}: ${r.confirmed} confirmed and ${r.unconfirmed} unconfirmed records`}>
            <span className="bar-confirmed" style={{ width: `${(r.confirmed / max) * 100}%` }} />
            <span className="bar-unconfirmed" style={{ width: `${(r.unconfirmed / max) * 100}%` }} />
          </div>
          <span className="mono">{r.count}</span>
        </div>
        <p className="meta" style={{ margin: "4px 0 0" }}>
          {r.confirmed} confirmed · {r.unconfirmed} unconfirmed
        </p>
      </div>
    );
  };
  return (
    <section className="panel pad">
      <h2>{title}</h2>
      <p className="meta" style={{ marginTop: 8 }}>
        Records in the directory, not an estimate of all alumni
      </p>
      {rows.slice(0, VISIBLE_ROWS).map((r) => bar(r))}
      {rows.length > VISIBLE_ROWS && (
        <details className="more-rows">
          <summary>
            Show {rows.length - VISIBLE_ROWS} more ({rows.slice(VISIBLE_ROWS).reduce((n, r) => n + r.count, 0)} records)
          </summary>
          {rows.slice(VISIBLE_ROWS).map((r) => bar(r))}
        </details>
      )}
      {unknown > 0 && (
        <p className="meta" style={{ marginTop: 20 }}>
          {unknown} {unknown === 1 ? "record has" : "records have"} {unknownLabel} on file.
        </p>
      )}
      <div className="legend">
        <span>
          <i />
          Confirmed
        </span>
        <span>
          <i className="est" />
          Unconfirmed records
        </span>
      </div>
    </section>
  );
}

async function Filters({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const { industries, places } = await getVocabulary();
  const sectors = industries.filter((i) => i.parent_id === null);
  return (
    <form id="insight-filters" className="filter-row" style={{ margin: "0 0 24px" }} method="get">
      <AutoSubmit formId="insight-filters" />
      <label className="field small">
        Industry
        <select name="industry" defaultValue={one(params.industry)}>
          <option value="">All industries</option>
          {sectors.map((s) => (
            <optgroup key={s.id} label={s.name}>
              <option value={s.slug}>All of {s.name}</option>
              {industries
                .filter((i) => i.parent_id === s.id)
                .map((i) => (
                  <option key={i.id} value={i.slug}>
                    {i.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field small">
        Market
        <select name="place" defaultValue={one(params.place)}>
          <option value="">All markets</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.state} (50 mi)
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button type="submit" className="btn">
          Show
        </button>
      </noscript>
    </form>
  );
}

async function Results({ searchParams }: { searchParams: Params }) {
  await requireMember("/insights");
  const params = await searchParams;
  const industry = one(params.industry);
  const placeId = Number(one(params.place)) || null;
  const supabase = await createClient();
  const [{ data, error }, { places }] = await Promise.all([
    supabase.rpc("network_insights", { p_industry_slugs: industry ? [industry] : null, p_place_id: placeId }),
    getVocabulary(),
  ]);
  if (error) {
    return (
      <div className="notice error" role="alert">
        <Icon name="info" />
        <div>The counts couldn’t be loaded. Refresh to try again.</div>
      </div>
    );
  }
  const r = data as Insights;
  if (!r.total) {
    return (
      <section className="panel">
        <EmptyState
          title="No records for this combination"
          text="Choose a different market or industry. Zero records here doesn’t mean there are no alumni there; the directory is still growing."
          action={
            <Link className="btn primary" href="/insights">
              Show everything
            </Link>
          }
        />
      </section>
    );
  }

  const searchHref = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(industry ? { industry } : {}), ...(placeId ? { place: String(placeId) } : {}), ...extra });
    return `/search?${q.toString()}`;
  };
  const max = Math.max(...r.by_market.map((m) => m.count), ...r.by_sector.map((s) => s.count), 1);

  return (
    <>
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="summary-strip">
          <div className="od-stat">
            <strong>{r.confirmed}</strong>
            <span>Confirmed records</span>
          </div>
          <div className="od-stat">
            <strong>{r.unconfirmed}</strong>
            <span>Unconfirmed records</span>
          </div>
          <div className="od-stat">
            <strong>—</strong>
            <span>Population estimate unavailable</span>
          </div>
        </div>
        <p className="meta pad">
          {r.total} matching {r.total === 1 ? "record" : "records"} · Built from the Wisconsin School of Business advisory boards and public
          sources so far. These are records in the directory, not a count of UW–Madison’s alumni population.
        </p>
      </section>
      <div className="form-grid insight-charts">
        <Chart
          title="By market"
          rows={r.by_market}
          unknown={r.no_market}
          unknownLabel="no location"
          max={max}
          hrefFor={(m) => {
            // "New York" metro → New York itself, not Brooklyn.
            const place = places.find((p) => p.metro === m.name && p.name === m.name) ?? places.find((p) => p.metro === m.name);
            return place ? searchHref({ place: String(place.id) }) : null;
          }}
        />
        <Chart
          title="By industry"
          rows={r.by_sector}
          unknown={r.no_sector}
          unknownLabel="no industry"
          max={max}
          hrefFor={(s) => (s.slug ? searchHref({ industry: s.slug }) : null)}
        />
      </div>
      <section className="notice" style={{ marginTop: 24 }}>
        <Icon name="info" />
        <div>
          <strong>Use concentration as a starting point.</strong>
          <p>For events or trips, combine these counts with who’s confirmed, what members say they’re open to, and travel access. Counts alone don’t establish demand.</p>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <Link className="btn quiet" style={{ paddingInline: 0 }} href="/trips/new">
              Plan a trip <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <>
      <PageTitle
        eyebrow="Community / Insights"
        title="See where the network comes together."
        description="Explore concentrations by market and industry, with confirmed and unconfirmed records always counted separately."
      />
      <CommunityTabs />
      <Suspense fallback={<div className="filter-row" style={{ margin: "0 0 24px", height: 70 }} />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense
        fallback={
          <div className="panel pad" role="status" aria-label="Loading insights">
            <div className="skeleton big" />
            <div className="skeleton" />
            <div className="skeleton short" />
          </div>
        }
      >
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}
