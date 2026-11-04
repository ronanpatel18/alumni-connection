import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/viewer";

export interface MyProfile {
  id: string;
  full_name: string;
  current_title: string | null;
  bio: string | null;
  place_id: number | null;
  city: string | null;
  state: string | null;
  industry_id: number | null;
  open_to: string[];
  status: string;
  organizations: { name: string } | null;
  educations: { school: string | null; degree: string | null; major: string | null; grad_year: number | null; verified_by: string | null }[];
  contact_points: { id: string; kind: string; value: string; source: string; visibility: string; verified_at: string | null }[];
  field_provenance: { field: string; source: string; source_url: string | null; fetched_at: string }[];
}

/** The signed-in member's own claimed profile, or null if they haven't claimed one. */
export async function loadMyProfile(viewer: Viewer): Promise<MyProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select(
      "id, full_name, current_title, bio, place_id, city, state, industry_id, open_to, status, organizations:current_organization_id(name), " +
        "educations(school, degree, major, grad_year, verified_by), " +
        "contact_points(id, kind, value, source, visibility, verified_at), field_provenance(field, source, source_url, fetched_at)",
    )
    .eq("claimed_by_user_id", viewer.userId)
    .maybeSingle<MyProfile>();
  if (error) throw error;
  return data;
}
