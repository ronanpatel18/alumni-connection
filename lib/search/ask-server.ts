import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonSummary } from "@/components/person";
import { getAi } from "@/lib/ai";
import { withDeadline } from "@/lib/ai/deadline";
import { type ParsedQuery, parsedQuerySchema } from "@/lib/ai/schemas";
import { groupCues } from "@/lib/people";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import type { AskFilters, AskMatch } from "./ask";
import { parseSearchText, type SearchVocabulary } from "./parse-query";

// Prompt search, server side: interpret the request (AI, with the rule parser
// as the instant fallback), fetch a hybrid shortlist, and have the AI order it
// and write one grounded reason each. Every AI step has a deadline, a rate
// limit and a cache; when any of them fails the member still gets results.

const CACHE_DAYS = 7;
const PARSE_DEADLINE_MS = 8_000;
const EMBED_DEADLINE_MS = 5_000;
export const SHORTLIST_SIZE = 30;

export type AskPerson = PersonSummary &
  AskMatch & {
    specialties: string[] | null;
    ai_summary: string[] | null;
    distance_miles: number | null;
  };

export interface Intent {
  parsed: ParsedQuery;
  placeId: number | null;
  /** The request's embedding as a pgvector literal, or null when unavailable. */
  embedding: string | null;
  embeddingModel: string | null;
  /** "ai": a model read the request. "rules": the keyword parser did (fixture mode, or the model was slow, limited or wrong). */
  source: "ai" | "rules";
}

const hashOf = (...parts: string[]) => createHash("sha256").update(parts.join("\0")).digest("hex");
const fresh = (createdAt: string) => Date.now() - Date.parse(createdAt) < CACHE_DAYS * 86_400_000;
const warn = (step: string, error: unknown) => console.warn(`[ask] ${step}:`, String((error as Error)?.message ?? error).slice(0, 160));

/** Free, instant reading of the request: also what every failure falls back to. */
function rulesIntent(text: string, vocab: SearchVocabulary) {
  const rules = parseSearchText(text, vocab);
  return { parsed: { ...rules.query, text: rules.query.text?.slice(0, 200) ?? null, goal: text.slice(0, 300) }, placeId: rules.placeId };
}

/** Under the per-member AI budget? Over it, callers use the free path instead of failing. */
async function aiAllowed(userId: string) {
  return (await checkRateLimit("ai-search", userId, LIMITS.aiSearch)).allowed;
}

export async function resolveIntent(db: SupabaseClient, userId: string, text: string, vocab: SearchVocabulary): Promise<Intent> {
  const ai = getAi();
  const live = ai.config.mode !== "fixture";
  const queryHash = hashOf("intent:v1", ai.embedModel, text.toLowerCase().replace(/\s+/g, " "));

  const { data: hit } = await db
    .from("ai_search_cache")
    .select("parsed, embedding, embedding_model, created_at")
    .eq("owner_user_id", userId)
    .eq("query_hash", queryHash)
    .maybeSingle<{ parsed: unknown; embedding: string | null; embedding_model: string | null; created_at: string }>();
  const cached = hit && fresh(hit.created_at) ? parsedQuerySchema.safeParse(hit.parsed) : null;
  if (hit && cached?.success) {
    const place = vocab.places.find((p) => p.name === cached.data.city && p.state === cached.data.state);
    return { parsed: cached.data, placeId: place?.id ?? null, embedding: hit.embedding, embeddingModel: hit.embedding_model, source: live ? "ai" : "rules" };
  }

  const rules = rulesIntent(text, vocab);
  const allowed = !live || (await aiAllowed(userId));

  const [parsedByAi, vectors] = await Promise.all([
    allowed
      ? withDeadline(ai.parseSearchQuery(text, vocab), PARSE_DEADLINE_MS).catch((error) => (warn("interpreting the request failed; using rules", error), null))
      : null,
    allowed
      ? withDeadline(ai.embed([text], "query"), EMBED_DEADLINE_MS).catch((error) => (warn("embedding the request failed; searching without it", error), null))
      : null,
  ]);

  let parsed = rules.parsed;
  let placeId = rules.placeId;
  if (parsedByAi) {
    const place = vocab.places.find((p) => p.name === parsedByAi.city && p.state === parsedByAi.state);
    // The dictionaries are exact, so they fill anything the model left out.
    const keepRulePlace = !place && rules.placeId !== null;
    const noYears = parsedByAi.gradYearMin === null && parsedByAi.gradYearMax === null;
    parsed = {
      ...parsedByAi,
      city: keepRulePlace ? rules.parsed.city : parsedByAi.city,
      state: keepRulePlace ? rules.parsed.state : parsedByAi.state,
      radiusMiles: parsedByAi.radiusMiles ?? rules.parsed.radiusMiles,
      gradYearMin: noYears ? rules.parsed.gradYearMin : parsedByAi.gradYearMin,
      gradYearMax: noYears ? rules.parsed.gradYearMax : parsedByAi.gradYearMax,
      goal: parsedByAi.goal ?? rules.parsed.goal,
    };
    placeId = place?.id ?? rules.placeId;
  }
  const embedding = vectors ? JSON.stringify(vectors[0]) : null;

  // A failed interpretation isn't cached, so the next search tries the model again.
  if (parsedByAi) {
    const { error } = await db.from("ai_search_cache").upsert(
      { owner_user_id: userId, query_hash: queryHash, parsed, embedding, embedding_model: embedding ? ai.embedModel : null, created_at: new Date().toISOString() },
      { onConflict: "owner_user_id,query_hash" },
    );
    if (error) warn("saving the interpretation failed", error);
  }
  return { parsed, placeId, embedding, embeddingModel: embedding ? ai.embedModel : null, source: parsedByAi && live ? "ai" : "rules" };
}

/** Up to SHORTLIST_SIZE people from filters, full-text and embedding similarity, best first. */
export async function shortlist(db: SupabaseClient, intent: Intent, filters: AskFilters, viewerPersonId: string | null): Promise<AskPerson[]> {
  const keywords = [...new Set([...intent.parsed.keywords, ...(intent.parsed.text ? [intent.parsed.text] : [])])].slice(0, 10);
  const { data, error } = await db.rpc("search_people_hybrid", {
    p_keywords: keywords.length ? keywords : null,
    p_query_embedding: intent.embedding,
    p_embedding_model: intent.embeddingModel,
    p_industry_slugs: filters.industrySlugs.length ? filters.industrySlugs : null,
    p_place_id: filters.placeId,
    p_radius_miles: filters.radius,
    p_grad_year_min: filters.gradFrom,
    p_grad_year_max: filters.gradTo,
    p_open_to: filters.openTo.length ? filters.openTo : null,
    p_seniority: filters.seniority.length ? filters.seniority : null,
    p_confirmed_only: filters.confirmedOnly,
    p_limit: SHORTLIST_SIZE + 1,
  });
  if (error) throw error;
  return ((data ?? []) as AskPerson[]).filter((p) => p.id !== viewerPersonId).slice(0, SHORTLIST_SIZE);
}

export interface Ranking {
  /** Person ids, most relevant first. */
  order: string[];
  reasons: Map<string, string>;
  /** False when the AI couldn't be used: the list keeps its retrieval order and shows facts only. */
  aiOrdered: boolean;
}

/**
 * The shortlist in the AI's order, with one "why" each (shown as "AI-generated
 * relevance"). Cached per member, request and shortlist in `recommendations`.
 * Never throws: on any failure the retrieval order stands.
 */
export async function rankShortlist(db: SupabaseClient, userId: string, request: string, people: AskPerson[]): Promise<Ranking> {
  const retrievalOrder = people.map((p) => p.id);
  const none: Ranking = { order: retrievalOrder, reasons: new Map(), aiOrdered: false };
  if (!people.length) return none;
  const goalHash = hashOf("ask:v1", request, ...[...retrievalOrder].sort());

  try {
    const { data: cached } = await db
      .from("recommendations")
      .select("person_id, score, reasons, created_at")
      .eq("owner_user_id", userId)
      .eq("goal_hash", goalHash)
      .order("score");
    const rows = (cached ?? []).filter((row) => fresh(row.created_at as string));
    if (rows.length === people.length) {
      return {
        order: rows.map((row) => row.person_id as string),
        reasons: new Map(rows.flatMap((row) => ((row.reasons as string[])[0] ? [[row.person_id as string, (row.reasons as string[])[0]]] : []))),
        aiOrdered: true,
      };
    }

    const ai = getAi();
    if (ai.config.mode !== "fixture" && !(await aiAllowed(userId))) return none;

    const cues = await groupCues(db, retrievalOrder);
    const ranked = await withDeadline(
      ai.rankMatches(
        request,
        people.map((p) => ({
          personId: p.id,
          fullName: p.full_name,
          title: p.current_title,
          organizationName: p.organization_name,
          industryName: p.industry_name ?? null,
          city: p.city,
          state: p.state,
          gradYear: p.grad_year,
          degree: p.degree,
          seniority: p.seniority,
          openTo: p.open_to ?? [],
          specialties: p.specialties ?? [],
          summary: p.ai_summary ?? [],
          groups: cues.get(p.id) ? [cues.get(p.id)!] : [],
        })),
      ),
    );

    const now = new Date().toISOString();
    const { error } = await db.from("recommendations").upsert(
      ranked.map((r, i) => ({ owner_user_id: userId, person_id: r.personId, goal_hash: goalHash, score: i, reasons: r.why ? [r.why] : [], created_at: now })),
      { onConflict: "owner_user_id,person_id,goal_hash" },
    );
    if (error) warn("saving the order failed", error);
    return {
      order: ranked.map((r) => r.personId),
      reasons: new Map(ranked.flatMap((r) => (r.why ? [[r.personId, r.why] as [string, string]] : []))),
      aiOrdered: true,
    };
  } catch (error) {
    warn("ordering the shortlist failed; showing closest matches", error);
    return none;
  }
}
