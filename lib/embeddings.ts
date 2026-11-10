// Fills people.embedding for prompt search. Shared by the backfill script and
// the Inngest job. A profile is (re)embedded when it has no vector, or one from
// a different model than the one configured now: vectors from different models
// can't be compared, and search ignores them until they're replaced.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ai } from "@/lib/ai";
import { embeddingText, loadProfileFacts } from "@/lib/profile-facts";

const BATCH = 20;

/** Ids of profiles whose embedding is missing or from another model. */
export async function peopleNeedingEmbeddings(db: SupabaseClient, model: string, { limit = 5000, force = false } = {}): Promise<string[]> {
  let query = db.from("people").select("id").neq("status", "opted_out").order("id").limit(limit);
  if (!force) query = query.or(`embedding.is.null,embedding_model.is.null,embedding_model.neq.${JSON.stringify(model)}`);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => row.id as string);
}

/** Embeds these profiles from their stored facts and summary. Returns how many were written. */
export async function embedPeople(db: SupabaseClient, ai: Ai, ids: string[], onProgress?: (done: number) => void): Promise<number> {
  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const loaded = (
      await Promise.all(
        batch.map(async (id) => {
          const profile = await loadProfileFacts(db, id);
          if (!profile) return null;
          const { data } = await db.from("people").select("ai_summary").eq("id", id).maybeSingle<{ ai_summary: string[] | null }>();
          // The name leads so a search for a person by name lands near them.
          return { id, text: `${profile.facts.fullName}\n${embeddingText(profile.facts, data?.ai_summary ?? [])}` };
        }),
      )
    ).filter((row) => row !== null);
    if (!loaded.length) continue;

    const vectors = await ai.embed(
      loaded.map((row) => row.text),
      "document",
    );
    for (const [index, row] of loaded.entries()) {
      const { error } = await db
        .from("people")
        .update({ embedding: JSON.stringify(vectors[index]), embedding_model: ai.embedModel })
        .eq("id", row.id);
      if (error) throw error;
    }
    done += loaded.length;
    onProgress?.(done);
  }
  return done;
}
