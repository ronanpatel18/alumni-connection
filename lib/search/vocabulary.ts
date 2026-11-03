import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { SearchVocabulary } from "./parse-query";

export interface IndustryRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  synonyms: string[];
}

export interface GroupRow {
  slug: string;
  name: string;
}

export interface PlaceRow {
  id: number;
  name: string;
  state: string;
  metro: string;
}

/** Industry taxonomy and places, used by the search form and the query parser. */
export async function loadVocabulary(db: SupabaseClient) {
  const [industries, places, groups] = await Promise.all([
    db.from("industries").select("id, slug, name, parent_id, synonyms").order("sort_order").returns<IndustryRow[]>(),
    db.from("places").select("id, name, state, metro").order("name").returns<PlaceRow[]>(),
    db.from("groups").select("slug, name").order("name").returns<GroupRow[]>(),
  ]);
  if (industries.error) throw industries.error;
  if (places.error) throw places.error;

  const vocab: SearchVocabulary = {
    industries: industries.data.map(({ slug, name, synonyms }) => ({ slug, name, synonyms })),
    places: places.data,
  };
  return { industries: industries.data, places: places.data, groups: groups.data ?? [], vocab };
}

/** Request-scoped copy so the form and the results don't both query it. */
export const getVocabulary = cache(async () => loadVocabulary(await createClient()));
