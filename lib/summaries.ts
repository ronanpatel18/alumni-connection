// The three-bullet "At a glance" summary every profile shows first.
//
// The AI model writes it from the stored facts. When the model can't be
// reached, or writes fewer than three bullets, plain sentences built from the
// same facts fill in, so no profile is ever without three. Nothing here states
// anything that isn't a stored fact.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ai } from "@/lib/ai";
import { factsHash } from "@/lib/ai/prompts";
import type { ProfileFacts } from "@/lib/ai/schemas";
import { embeddingText, loadProfileFacts } from "@/lib/profile-facts";

export const SUMMARY_BULLETS = 3;

const place = (facts: ProfileFacts) => [facts.city, facts.state].filter(Boolean).join(", ");
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
const list = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Plain sentences stating the stored facts, most useful first. Always at least three. */
export function factBullets(facts: ProfileFacts): string[] {
  const bullets: string[] = [];
  const where = place(facts);
  const role = [facts.currentTitle, facts.organizationName].filter(Boolean).join(" at ");
  if (role) bullets.push(sentence(`${facts.currentTitle ? "" : "Works at "}${role}${where ? `, based in ${where}` : ""}`));
  else if (where) bullets.push(`Based in ${where}.`);

  const degrees = facts.educations
    .map((e) => {
      const what = [e.degree, e.major].filter(Boolean).join(", ");
      const school = e.school && !/wisconsin/i.test(e.school) ? e.school : "UW–Madison";
      return what || e.gradYear ? `${what ? `${what} from ${school}` : `${school} graduate`}${e.gradYear ? ` (${e.gradYear})` : ""}` : null;
    })
    .filter((d): d is string => Boolean(d));
  if (degrees.length) bullets.push(sentence(`Education: ${list(degrees.slice(0, 2))}`));

  const earlier = facts.positions.filter((p) => !p.isCurrent && p.organizationName && p.organizationName !== facts.organizationName);
  const employers = [...new Set(earlier.map((p) => p.organizationName))];
  if (employers.length) bullets.push(sentence(`Earlier roles at ${list(employers.slice(0, 3))}`));

  if (facts.specialties.length) bullets.push(sentence(`Focus areas include ${list(facts.specialties.slice(0, 3))}`));
  if (facts.industryName) bullets.push(sentence(`Works in ${facts.industryName}`));
  if (role && where && bullets.length < SUMMARY_BULLETS) bullets.push(`Based in ${where}.`);

  // A thin profile still gets three honest lines.
  bullets.push("Part of the University of Wisconsin–Madison alumni network.");
  if (!role) bullets.push("Current role and employer haven’t been confirmed yet.");
  if (!degrees.length) bullets.push("Degree and class year haven’t been confirmed yet.");
  if (!where) bullets.push("Location hasn’t been confirmed yet.");
  return bullets;
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/** Does this bullet mostly repeat what the others already say? */
function repeats(bullet: string, others: string[]): boolean {
  const mine = words(bullet);
  if (!mine.size) return true;
  const theirs = new Set(others.flatMap((o) => [...words(o)]));
  return [...mine].filter((w) => theirs.has(w)).length / mine.size >= 0.6;
}

/** Exactly three bullets: the written ones first, then stored facts that add something. */
export function threeBullets(written: string[] | null | undefined, facts: ProfileFacts): string[] {
  const out = (written ?? []).map((b) => b.trim()).filter(Boolean).slice(0, SUMMARY_BULLETS);
  const spare = factBullets(facts);
  for (const bullet of spare) {
    if (out.length >= SUMMARY_BULLETS) break;
    if (!repeats(bullet, out)) out.push(bullet);
  }
  // Everything left repeats something: take them anyway rather than show fewer than three.
  for (const bullet of spare) {
    if (out.length >= SUMMARY_BULLETS) break;
    if (!out.includes(bullet)) out.push(bullet);
  }
  return out;
}

export type SummaryOutcome = "written" | "from_facts" | "unchanged" | "not_found";

/**
 * Writes one profile's summary (and search embedding) from its stored facts.
 * Skips the model when the facts haven't changed. If the model can't be
 * reached, the summary is built from the facts and left marked for a rewrite.
 */
export async function summarizePerson(db: SupabaseClient, ai: Ai, personId: string, { force = false }: { force?: boolean } = {}): Promise<SummaryOutcome> {
  const { data: current } = await db.from("people").select("ai_summary").eq("id", personId).maybeSingle<{ ai_summary: string[] | null }>();
  const loaded = await loadProfileFacts(db, personId);
  if (!loaded) return "not_found";
  const hash = factsHash(loaded.facts);
  if (!force && hash === loaded.summaryInputHash && current?.ai_summary?.length === SUMMARY_BULLETS) return "unchanged";

  let written: { summary: string[]; confidence: number; model: string } | null = null;
  try {
    written = await ai.summarizeProfile(loaded.facts);
  } catch {
    written = null;
  }
  const summary = threeBullets(written?.summary, loaded.facts);
  const update: Record<string, unknown> = { ai_summary: summary, summary_input_hash: written ? hash : null };
  try {
    const [embedding] = await ai.embed([embeddingText(loaded.facts, summary)]);
    update.embedding = JSON.stringify(embedding);
    update.embedding_model = ai.embedModel;
  } catch {
    // Search works without it; the embedding job fills it in later.
  }
  const { error } = await db.from("people").update(update).eq("id", personId);
  if (error) throw error;
  if (written) {
    await db
      .from("field_provenance")
      .upsert({ person_id: personId, field: "ai_summary", source: "ai", confidence: written.confidence, fetched_at: new Date().toISOString() }, { onConflict: "person_id,field,source" });
  }
  return written ? "written" : "from_facts";
}

/** Profiles with no summary, or one the model hasn't written yet. */
export async function peopleNeedingSummaries(db: SupabaseClient, limit: number): Promise<string[]> {
  const { data, error } = await db
    .from("people")
    .select("id")
    .or("ai_summary.is.null,summary_input_hash.is.null")
    .neq("status", "opted_out")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((row) => row.id as string);
}

/** Summarizes a batch, one at a time with a pause (free model tiers limit requests per minute). */
export async function summarizeMissing(db: SupabaseClient, ai: Ai, { limit, gapMs = 1500 }: { limit: number; gapMs?: number }) {
  const tally = { written: 0, from_facts: 0, unchanged: 0, not_found: 0 };
  const ids = await peopleNeedingSummaries(db, limit);
  for (const [i, id] of ids.entries()) {
    if (i && gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    tally[await summarizePerson(db, ai, id).catch(() => "not_found" as const)]++;
  }
  return tally;
}
