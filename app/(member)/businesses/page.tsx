import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CommunityTabs } from "@/components/community-tabs";
import { Icon } from "@/components/icon";
import { ResultNotice } from "@/components/notice";
import { EmptyState, PageTitle } from "@/components/person";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { removeBusiness } from "./actions";

export const metadata: Metadata = { title: "Alumni businesses" };

const RESULTS = {
  listed: { text: "Your business is listed." },
  removed: { text: "The listing was removed." },
  error: { tone: "error" as const, text: "That couldn’t be saved. Refresh and try again." },
};

interface Business {
  id: string;
  name: string;
  category: string;
  description: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  alumni_offer: string | null;
  owner_name: string;
  owner_person_id: string | null;
  is_mine: boolean;
}

interface Founder {
  id: string;
  full_name: string;
  current_title: string | null;
  city: string | null;
  state: string | null;
  organizations: { name: string; website: string | null } | null;
}

const placeOf = (b: { city: string | null; state: string | null }) => [b.city, b.state].filter(Boolean).join(", ");
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

async function Businesses({ searchParams }: { searchParams: PageProps<"/businesses">["searchParams"] }) {
  const viewer = await requireMember("/businesses");
  const { q, category, city, result } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().toLowerCase();
  const supabase = await createClient();
  const [{ data, error }, { data: founderRows }] = await Promise.all([
    supabase.rpc("business_directory"),
    // Founders and owners already in the directory, so the page is useful before members add listings.
    supabase
      .from("people")
      .select("id, full_name, current_title, city, state, organizations:current_organization_id!inner(name, website)")
      .eq("seniority", "owner")
      .order("full_name")
      .limit(200)
      .returns<Founder[]>(),
  ]);
  if (error) throw error;
  const all = (data ?? []) as Business[];
  const categories = [...new Set(all.map((b) => b.category))].sort();
  const cities = [...new Set(all.map(placeOf).filter(Boolean))].sort();
  const listings = all.filter(
    (b) =>
      (!query || [b.name, b.category, b.description, b.city, b.owner_name].filter(Boolean).join(" ").toLowerCase().includes(query)) &&
      (typeof category !== "string" || !category || b.category === category) &&
      (typeof city !== "string" || !city || placeOf(b) === city),
  );
  const filtering = Boolean(query || category || city);
  const founders = (founderRows ?? []).filter((f) => f.organizations && (!query || [f.full_name, f.organizations.name, f.city].filter(Boolean).join(" ").toLowerCase().includes(query)));

  return (
    <>
      <ResultNotice result={result} messages={RESULTS} />
      <form className="filter-row" action="/businesses" role="search" style={{ margin: "0 0 24px" }}>
        <input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Name, owner or what they do" aria-label="Search businesses" style={{ maxWidth: 280 }} />
        <select name="category" defaultValue={typeof category === "string" ? category : ""} aria-label="Category">
          <option value="">Every category</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select name="city" defaultValue={typeof city === "string" ? city : ""} aria-label="City">
          <option value="">Every city</option>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="btn">
          Search
        </button>
        <Link className="btn primary" href="/businesses/new" style={{ marginLeft: "auto" }}>
          <Icon name="plus" /> List your business
        </Link>
      </form>
      <div className="stack">
        <section className="panel">
          <div className="table-title" style={{ paddingBottom: listings.length ? 0 : 24 }}>
            <div className="section-head" style={{ margin: 0 }}>
              <h2>Listed by members</h2>
              <span className="badge-count">{listings.length}</span>
            </div>
          </div>
          {listings.length === 0 ? (
            <EmptyState
              title={filtering ? "No listings match" : "No businesses listed yet"}
              text={filtering ? "Try fewer filters." : "Own or run a business? List it so fellow Badgers can find you, hire you and send customers your way."}
              action={
                <Link className="btn primary" href="/businesses/new">
                  List your business
                </Link>
              }
            />
          ) : (
            <div className="detail-list">
              {listings.map((b) => (
                <div key={b.id} className="detail-row" style={{ padding: 24 }}>
                  <div className="od-cluster" style={{ justifyContent: "space-between" }}>
                    <h3>{b.name}</h3>
                    <span className="chip subtle">{b.category}</span>
                  </div>
                  <p className="small muted">
                    {placeOf(b) && (
                      <>
                        <Icon name="pin" /> {placeOf(b)} ·{" "}
                      </>
                    )}
                    Owned by {b.owner_person_id ? <Link href={`/people/${b.owner_person_id}`}>{b.owner_name}</Link> : b.owner_name}
                  </p>
                  {b.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{b.description}</p>}
                  {b.alumni_offer && (
                    <p className="small">
                      <span className="chip ai">For alumni</span> {b.alumni_offer}
                    </p>
                  )}
                  <div className="od-cluster">
                    {b.website && (
                      <a className="btn" href={b.website} target="_blank" rel="noreferrer noopener">
                        {host(b.website)}
                      </a>
                    )}
                    {!b.is_mine && b.owner_person_id && (
                      <Link className="btn quiet" href={`/messages/new?person=${b.owner_person_id}&subject=${encodeURIComponent(`About ${b.name}`.slice(0, 200))}`}>
                        <Icon name="mail" /> Message the owner
                      </Link>
                    )}
                    {(b.is_mine || viewer.isAdmin) && (
                      <form action={removeBusiness}>
                        <input type="hidden" name="id" value={b.id} />
                        <button type="submit" className="btn quiet">
                          Remove listing
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        {founders.length > 0 && !category && !city && (
          <section className="panel">
            <div className="table-title">
              <div className="section-head" style={{ margin: 0 }}>
                <h2>Founders and owners in the directory</h2>
                <span className="badge-count">{founders.length}</span>
              </div>
              <p className="meta" style={{ marginTop: 8 }}>
                From profiles whose title says founder or owner. These aren’t listings; open a profile to learn more.
              </p>
            </div>
            <div className="table-wrap">
              <table className="responsive">
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Person</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {founders.map((f) => (
                    <tr key={f.id}>
                      <td data-label="Business">
                        <strong>{f.organizations!.name}</strong>
                      </td>
                      <td data-label="Person">
                        <Link href={`/people/${f.id}`}>{f.full_name}</Link>
                        {f.current_title && <p className="meta">{f.current_title}</p>}
                      </td>
                      <td data-label="Location">{placeOf(f) || <span className="muted">Not known</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

export default function BusinessesPage({ searchParams }: PageProps<"/businesses">) {
  return (
    <>
      <PageTitle eyebrow="Community / Alumni businesses" title="Do business with Badgers." description="Businesses owned or run by alumni, listed by the members themselves." />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Businesses searchParams={searchParams} />
      </Suspense>
    </>
  );
}
