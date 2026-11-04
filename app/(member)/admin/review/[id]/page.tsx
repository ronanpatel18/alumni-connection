import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { Icon } from "@/components/icon";
import { Avatar, PageTitle } from "@/components/person";
import { FIELD_LABELS, SOURCE_LABELS } from "@/lib/provenance";
import { getVocabulary } from "@/lib/search/vocabulary";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Review profile" };

interface ReviewPerson {
  id: string;
  full_name: string;
  photo_url: string | null;
  current_title: string | null;
  city: string | null;
  state: string | null;
  industry_id: number | null;
  alumni_status: string;
  claimed_by_user_id: string | null;
  bio: string | null;
  organizations: { name: string } | null;
  educations: { id: string; degree: string | null; major: string | null; school: string | null; grad_year: number | null }[];
  field_provenance: { field: string; source: string; source_url: string | null; confidence: number | null }[];
  person_external_ids: { source: string; url: string | null }[];
  contact_points: { kind: string; value: string }[];
}

/** Web searches an administrator can run to check a class year or role. */
function researchLinks(name: string) {
  const q = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return [
    { label: "UW–Madison mentions", href: q(`"${name}" "University of Wisconsin"`) },
    { label: "Class year mentions", href: q(`"${name}" Wisconsin ("class of" OR BBA OR MBA OR graduated)`) },
    { label: "LinkedIn education", href: q(`site:linkedin.com/in "${name}" "University of Wisconsin-Madison"`) },
    { label: "SEC filings (executives)", href: `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${name}" "University of Wisconsin"`)}` },
  ];
}

async function Review({ params }: { params: PageProps<"/admin/review/[id]">["params"] }) {
  const { id } = await params;
  await requireAdmin(`/admin/review/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: person }, { data: reasons }, { industries }] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, full_name, photo_url, current_title, city, state, industry_id, alumni_status, claimed_by_user_id, bio, organizations:current_organization_id(name), " +
          "educations(id, degree, major, school, grad_year), field_provenance(field, source, source_url, confidence), " +
          "person_external_ids(source, url), contact_points(kind, value)",
      )
      .eq("id", id)
      .maybeSingle<ReviewPerson>(),
    supabase.rpc("admin_review_queue"),
    getVocabulary(),
  ]);
  if (!person) notFound();

  if (person.claimed_by_user_id) {
    return (
      <div className="notice" role="status">
        <Icon name="lock" />
        <div>
          <p>{person.full_name} has claimed this profile, so they keep it up to date themselves.</p>
          <p>
            <Link href={`/people/${person.id}`}>View the profile</Link>
          </p>
        </div>
      </div>
    );
  }

  const sectors = industries.filter((i) => i.parent_id === null);
  const listing = person.person_external_ids.find((x) => x.url);
  // One row per source page, listing every field it supplied.
  const bySource = new Map<string, { source: string; fields: string[] }>();
  for (const p of person.field_provenance) {
    if (!p.source_url) continue;
    const entry = bySource.get(p.source_url) ?? { source: p.source, fields: [] };
    entry.fields.push(FIELD_LABELS[p.field] ?? p.field);
    bySource.set(p.source_url, entry);
  }
  const sources = [...bySource.entries()].filter(([url]) => url !== listing?.url);
  const listingFields = listing?.url ? bySource.get(listing.url)?.fields : undefined;
  const linkedin = person.contact_points.find((c) => c.kind === "linkedin");

  return (
    <div className="split">
      <ReviewForm
        reasons={((reasons ?? []) as { person_id: string; reasons: string[] }[]).find((r) => r.person_id === person.id)?.reasons ?? []}
        defaults={{
          person_id: person.id,
          full_name: person.full_name,
          current_title: person.current_title ?? "",
          employer: person.organizations?.name ?? "",
          city: person.city ?? "",
          state: person.state ?? "",
          industry_id: person.industry_id ? String(person.industry_id) : "",
          alumni_status: person.alumni_status,
          educations: [...person.educations]
            .sort((a, b) => (a.grad_year ?? 9999) - (b.grad_year ?? 9999))
            .map((e) => ({
              id: e.id,
              degree: e.degree ?? "",
              major: e.major ?? "",
              school: e.school ?? "",
              grad_year: e.grad_year ? String(e.grad_year) : "",
            })),
        }}
        industries={sectors.map((sector) => ({
          sector: sector.name,
          options: [sector, ...industries.filter((i) => i.parent_id === sector.id)].map((i) => ({
            value: String(i.id),
            label: i.id === sector.id ? `All of ${i.name}` : i.name,
          })),
        }))}
      />

      <aside className="right-rail stack">
        <section className="panel pad">
          <div className="od-row" style={{ alignItems: "center", marginBottom: 16 }}>
            <Avatar name={person.full_name} photoUrl={person.photo_url} confirmed={false} />
            <div>
              <strong>{person.full_name}</strong>
              <p className="meta">
                <Link href={`/people/${person.id}`}>Open the profile</Link>
              </p>
            </div>
          </div>
          <h2 className="rail-title">Sources</h2>
          <div className="detail-list">
            {listing && (
              <div className="detail-row">
                <strong className="small">Board listing</strong>
                {listingFields && <span className="meta">{listingFields.join(", ")}</span>}
                <a className="small od-truncate" href={listing.url!} target="_blank" rel="noreferrer noopener">
                  {listing.url!.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}
            {linkedin && (
              <div className="detail-row">
                <strong className="small">LinkedIn (found by web search)</strong>
                <a className="small od-truncate" href={linkedin.value} target="_blank" rel="noreferrer noopener">
                  {linkedin.value.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </div>
            )}
            {sources.map(([url, entry]) => (
              <div key={url} className="detail-row">
                <strong className="small">{SOURCE_LABELS[entry.source] ?? entry.source}</strong>
                <span className="meta">{entry.fields.join(", ")}</span>
                <a className="small od-truncate" href={url} target="_blank" rel="noreferrer noopener">
                  {url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </div>
            ))}
            {!listing && !linkedin && sources.length === 0 && <p className="small muted">No source links recorded.</p>}
          </div>
        </section>

        <section className="panel pad">
          <h2 className="rail-title">Look it up</h2>
          <p className="small muted" style={{ marginBottom: 16 }}>
            Searches that often turn up a class year: alumni news, LinkedIn education entries, and executive bios in SEC filings.
          </p>
          <div className="rail-list">
            {researchLinks(person.full_name).map((l) => (
              <a key={l.label} className="rail-link small" href={l.href} target="_blank" rel="noreferrer noopener">
                <Icon name="search" /> {l.label}
              </a>
            ))}
          </div>
        </section>

        {person.bio && (
          <section className="panel pad">
            <h2 className="rail-title">Bio on file</h2>
            <p className="small bio">{person.bio}</p>
          </section>
        )}
      </aside>
    </div>
  );
}

export default function ReviewProfilePage({ params }: PageProps<"/admin/review/[id]">) {
  return (
    <>
      <PageTitle eyebrow="Administration / Profile review" title="Review a profile." description="Compare each field with its sources, correct what’s wrong, and note what you checked." />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Review params={params} />
      </Suspense>
    </>
  );
}
