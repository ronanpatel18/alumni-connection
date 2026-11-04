import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileFacts } from "@/lib/ai/schemas";

interface PersonRow {
  id: string;
  full_name: string;
  current_title: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  specialties: string[];
  summary_input_hash: string | null;
  organizations: { name: string } | null;
  industries: { name: string } | null;
  educations: { school: string | null; degree: string | null; major: string | null; grad_year: number | null }[];
  positions: { title: string; organization_name: string; is_current: boolean; start_date: string | null; end_date: string | null }[];
}

/** Gathers the facts the AI is allowed to summarize. Nothing outside this object reaches the model. */
export async function loadProfileFacts(
  db: SupabaseClient,
  personId: string,
): Promise<{ facts: ProfileFacts; summaryInputHash: string | null } | null> {
  const { data, error } = await db
    .from("people")
    .select(
      "id, full_name, current_title, bio, city, state, specialties, summary_input_hash, " +
        "organizations:current_organization_id(name), industries:industry_id(name), " +
        "educations(school, degree, major, grad_year), positions(title, organization_name, is_current, start_date, end_date)",
    )
    .eq("id", personId)
    .maybeSingle<PersonRow>();
  if (error) throw error;
  if (!data) return null;

  return {
    summaryInputHash: data.summary_input_hash,
    facts: {
      fullName: data.full_name,
      currentTitle: data.current_title,
      organizationName: data.organizations?.name ?? null,
      industryName: data.industries?.name ?? null,
      city: data.city,
      state: data.state,
      specialties: data.specialties,
      bio: data.bio,
      educations: [...data.educations]
        .sort((a, b) => (a.grad_year ?? 0) - (b.grad_year ?? 0))
        .map((e) => ({ school: e.school, degree: e.degree, major: e.major, gradYear: e.grad_year })),
      positions: [...data.positions]
        .sort((a, b) => Number(b.is_current) - Number(a.is_current) || (b.start_date ?? "").localeCompare(a.start_date ?? ""))
        .map((p) => ({
          title: p.title,
          organizationName: p.organization_name,
          isCurrent: p.is_current,
          startYear: p.start_date ? Number(p.start_date.slice(0, 4)) : null,
          endYear: p.end_date ? Number(p.end_date.slice(0, 4)) : null,
        })),
    },
  };
}

/** Text used for the profile's embedding (similar-people search). */
export function embeddingText(facts: ProfileFacts, summary: string[]): string {
  return [
    facts.currentTitle,
    facts.organizationName,
    facts.industryName,
    facts.city && `${facts.city}, ${facts.state}`,
    facts.specialties.join(", "),
    ...facts.educations.map((e) => [e.degree, e.major, e.school].filter(Boolean).join(" ")),
    ...summary,
  ]
    .filter(Boolean)
    .join("\n");
}
