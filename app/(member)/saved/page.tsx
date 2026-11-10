import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle, PersonRow, type PersonSummary } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { groupCues, linkedinUrls } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Saved contacts" };

interface SavedRow {
  created_at: string;
  people: {
    id: string;
    full_name: string;
    current_title: string | null;
    city: string | null;
    state: string | null;
    metro: string | null;
    status: string;
    photo_url: string | null;
    open_to: string[];
    organizations: { name: string } | null;
    educations: { degree: string | null; grad_year: number | null }[];
  } | null;
}

async function SavedList({ searchParams }: { searchParams: PageProps<"/saved">["searchParams"] }) {
  const viewer = await requireMember("/saved");
  const { q } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().toLowerCase();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_contacts")
    .select(
      "created_at, people(id, full_name, current_title, city, state, metro, status, photo_url, open_to, " +
        "organizations:current_organization_id(name), educations(degree, grad_year))",
    )
    .eq("owner_user_id", viewer.userId)
    .order("created_at", { ascending: false })
    .returns<SavedRow[]>();
  if (error) throw error;

  const people: PersonSummary[] = data
    .map((row) => row.people)
    .filter((p): p is NonNullable<SavedRow["people"]> => Boolean(p))
    .map((p) => {
      const edu = [...p.educations].sort((a, b) => (a.grad_year ?? 9999) - (b.grad_year ?? 9999))[0];
      return {
        id: p.id,
        full_name: p.full_name,
        current_title: p.current_title,
        organization_name: p.organizations?.name ?? null,
        city: p.city,
        state: p.state,
        metro: p.metro,
        status: p.status,
        photo_url: p.photo_url,
        open_to: p.open_to,
        grad_year: edu?.grad_year ?? null,
        degree: edu?.degree ?? null,
      };
    });
  const matches = query
    ? people.filter((p) => [p.full_name, p.organization_name, p.city].filter(Boolean).join(" ").toLowerCase().includes(query))
    : people;
  const matchIds = matches.map((p) => p.id);
  const [cues, linkedin] = await Promise.all([groupCues(supabase, matchIds), linkedinUrls(supabase, matchIds)]);

  if (!matches.length) {
    return (
      <div className="panel">
      <EmptyState
        title={query ? "No saved contacts match" : "No saved contacts yet"}
        text={query ? "Try another name or clear the search." : "Save someone from discovery to find them here."}
        action={
          <Link className="btn primary" href="/search">
            Find alumni
          </Link>
        }
      />
      </div>
    );
  }
  return (
    <>
      {matches.map((person) => (
        <PersonRow key={person.id} person={person} saved cue={cues.get(person.id)} linkedin={linkedin.get(person.id)} />
      ))}
    </>
  );
}

async function SavedSearch({ searchParams }: { searchParams: PageProps<"/saved">["searchParams"] }) {
  const { q } = await searchParams;
  return (
    <form className="field" style={{ maxWidth: 480, marginBottom: 24 }} action="/saved" role="search">
      <label htmlFor="saved-search">Find a saved contact</label>
      <input id="saved-search" name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Search name, company, or city" />
    </form>
  );
}

export default function SavedPage({ searchParams }: PageProps<"/saved">) {
  return (
    <>
      <PageTitle
        eyebrow="Relationships / Saved contacts"
        title="People you want to stay close to."
        description="Saved contacts are private. Saving someone doesn’t notify them."
      />
      <RelationshipTabs />
      <Suspense>
        <SavedSearch searchParams={searchParams} />
      </Suspense>
      <section className="person-cards">
        <Suspense
          fallback={
            <div className="loading-row" role="status" aria-label="Loading saved contacts">
              <div className="skeleton big" />
              <div className="skeleton" />
            </div>
          }
        >
          <SavedList searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  );
}
