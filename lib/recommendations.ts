import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonSummary } from "@/components/person";
import { getAi } from "@/lib/ai";
import { groupCues } from "@/lib/people";
import type { Viewer } from "@/lib/viewer";

// "Who to meet": suggestions ranked against the member's own goal (never one
// global ranking). The order comes from plain, explainable signals below; the
// AI only writes the "why" line. No score is shown (design/system/DESIGN.md).

export const GOALS = {
  partners: { label: "Build business partnerships", phrase: "build business partnerships" },
  clients: { label: "Find clients and referrals", phrase: "find clients and referrals" },
  investors: { label: "Meet investors", phrase: "meet investors" },
  mentor: { label: "Find a mentor", phrase: "find a mentor" },
} as const;
export type Goal = keyof typeof GOALS;
export const isGoal = (value: unknown): value is Goal => typeof value === "string" && value in GOALS;

const SENIORITY_LABELS: Record<string, string> = {
  c_suite: "Executive",
  owner: "Owner",
  partner: "Partner",
  vp: "Vice president",
  director: "Director",
  senior: "Senior professional",
  manager: "Manager",
};

const POOL_SIZE = 60;
const EXPLAIN_LIMIT = 10;
const FINANCE_SECTOR = "finance";
const INVESTING = new Set(["private-equity", "venture-capital", "asset-management", "wealth-management", "investment-banking", "finance"]);

export interface Suggestion {
  person: PersonSummary;
  /** Plain facts the order rests on, shown as "Evidence: …". */
  evidence: string[];
}

export interface Signals {
  id: string;
  seniority: string | null;
  industries: { slug: string; parent: { slug: string } | null } | null;
  positions: { start_date: string | null }[];
}

/** How well someone fits a goal (internal order only; never shown). Exported for tests. */
export function scoreForGoal(goal: Goal, person: PersonSummary, s: Signals | undefined, viewerSector: string | null): number {
  const seniority = s?.seniority ?? "";
  const openTo = person.open_to ?? [];
  const slug = s?.industries?.slug ?? "";
  const sector = s?.industries?.parent?.slug ?? slug;
  const confirmed = person.status === "claimed" || person.status === "verified" ? 1 : 0;
  const earliest = (s?.positions ?? []).map((p) => p.start_date).filter(Boolean).sort()[0];
  const careerYears = earliest ? new Date().getFullYear() - Number(earliest!.slice(0, 4)) : person.grad_year ? new Date().getFullYear() - person.grad_year : 0;
  const leader = { c_suite: 3, owner: 3, partner: 3, vp: 2, director: 2, senior: 1, manager: 1 }[seniority] ?? 0;

  switch (goal) {
    case "partners":
      return leader + confirmed + (openTo.includes("networking") ? 2 : 0) + (viewerSector && sector === viewerSector ? 2 : 0);
    case "clients":
      return ({ c_suite: 3, owner: 3, vp: 2, director: 2, partner: 2 }[seniority] ?? 0) + (openTo.includes("referrals") ? 2 : 0) + confirmed;
    case "investors":
      return (INVESTING.has(slug) ? 4 : 0) + (openTo.includes("investing") ? 3 : 0) + (["partner", "c_suite", "owner"].includes(seniority) ? 2 : 0) + confirmed;
    case "mentor":
      return (openTo.includes("mentoring") ? 4 : 0) + (careerYears >= 15 ? 2 : careerYears >= 8 ? 1 : 0) + Math.min(leader, 2) + confirmed;
  }
}

function evidenceFor(goal: Goal, person: PersonSummary, s: Signals | undefined): string[] {
  const out: string[] = [];
  const level = SENIORITY_LABELS[s?.seniority ?? ""];
  if (level) out.push(level);
  if (person.industry_name) out.push(person.industry_name);
  const market = person.metro ?? person.city;
  if (market) out.push(market);
  const openTo = person.open_to ?? [];
  if (goal === "mentor" && openTo.includes("mentoring")) out.push("open to mentoring");
  if (goal === "investors" && openTo.includes("investing")) out.push("open to investing");
  if (goal === "clients" && openTo.includes("referrals")) out.push("open to referrals");
  if (goal === "partners" && openTo.includes("networking")) out.push("open to networking");
  if (person.status === "claimed" || person.status === "verified") out.push("confirmed profile");
  return out;
}

/** Ranked suggestions for this member, goal and (optional) market. */
export async function suggestions(
  db: SupabaseClient,
  viewer: Viewer,
  { goal, placeId, limit }: { goal: Goal; placeId: number | null; limit: number },
): Promise<Suggestion[]> {
  const { data, error } = await db.rpc("search_people", {
    p_place_id: placeId,
    p_radius_miles: 50,
    p_industry_slugs: goal === "investors" ? [FINANCE_SECTOR] : null,
    p_limit: POOL_SIZE,
  });
  if (error) throw error;
  const pool = ((data ?? []) as PersonSummary[]).filter((p) => p.id !== viewer.personId);
  if (!pool.length) return [];

  const [{ data: signals }, viewerSector] = await Promise.all([
    db
      .from("people")
      .select("id, seniority, industries:industry_id(slug, parent:parent_id(slug)), positions(start_date)")
      .in(
        "id",
        pool.map((p) => p.id),
      )
      .returns<Signals[]>(),
    viewer.personId
      ? db
          .from("people")
          .select("industries:industry_id(slug, parent:parent_id(slug))")
          .eq("id", viewer.personId)
          .maybeSingle<{ industries: { slug: string; parent: { slug: string } | null } | null }>()
          .then(({ data: me }) => me?.industries?.parent?.slug ?? me?.industries?.slug ?? null)
      : Promise.resolve(null),
  ]);
  const byId = new Map((signals ?? []).map((s) => [s.id, s]));

  // Ties go to fuller profiles (work history, a known class year), then search order.
  const completeness = (person: PersonSummary) => Math.min(byId.get(person.id)?.positions.length ?? 0, 5) + (person.grad_year ? 1 : 0);
  return pool
    .map((person, order) => ({ person, order, value: scoreForGoal(goal, person, byId.get(person.id), viewerSector), full: completeness(person) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || b.full - a.full || a.order - b.order)
    .slice(0, limit)
    .map(({ person }) => ({ person, evidence: evidenceFor(goal, person, byId.get(person.id)) }));
}

/**
 * One "why" per suggestion, tied to the goal (shown as "AI-generated relevance").
 * Cached per member, goal and market; people the AI skips are remembered with
 * no line. If the AI is unavailable, suggestions show without lines.
 */
export async function suggestionReasons(
  db: SupabaseClient,
  userId: string,
  goal: Goal,
  marketLabel: string | null,
  people: PersonSummary[],
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  if (!people.length) return reasons;
  const hash = createHash("sha256").update(`who:${goal}:${marketLabel ?? "any"}`).digest("hex");
  const { data: cached } = await db
    .from("recommendations")
    .select("person_id, reasons")
    .eq("goal_hash", hash)
    .in(
      "person_id",
      people.map((p) => p.id),
    );
  const asked = new Set<string>();
  for (const row of cached ?? []) {
    asked.add(row.person_id as string);
    const why = (row.reasons as string[])[0];
    if (why) reasons.set(row.person_id as string, why);
  }
  const missing = people.filter((p) => !asked.has(p.id)).slice(0, EXPLAIN_LIMIT);
  if (!missing.length) return reasons;

  try {
    const cues = await groupCues(
      db,
      missing.map((p) => p.id),
    );
    const { matches } = await getAi().explainMatches(
      `I want to ${GOALS[goal].phrase}${marketLabel ? ` in ${marketLabel}` : ""}.`,
      missing.map((p) => ({
        personId: p.id,
        fullName: p.full_name,
        headline: [p.current_title, p.organization_name].filter(Boolean).join(" at ") || null,
        city: p.metro ?? p.city,
        industryName: p.industry_name ?? null,
        gradYear: p.grad_year,
        sharedContext: [],
        groups: cues.get(p.id) ? [cues.get(p.id)!] : [],
      })),
    );
    const written = new Map(matches.map((m) => [m.personId, m.why]));
    await db.from("recommendations").upsert(
      missing.map((p, i) => ({
        owner_user_id: userId,
        person_id: p.id,
        goal_hash: hash,
        score: i,
        reasons: written.has(p.id) ? [written.get(p.id)] : [],
      })),
      { onConflict: "owner_user_id,person_id,goal_hash" },
    );
    for (const [id, why] of written) reasons.set(id, why);
  } catch (error) {
    console.warn("[who-to-meet] relevance lines unavailable:", (error as Error).message.slice(0, 160));
  }
  return reasons;
}
