import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonSummary } from "@/components/person";
import { getAi } from "@/lib/ai";
import { groupCues } from "@/lib/people";

export interface Trip {
  id: string;
  place_id: number;
  starts_on: string;
  ends_on: string;
  industry_slugs: string[];
  goal: string | null;
  created_at: string;
  places: { name: string; state: string } | null;
}

/** How far around the destination to look; matches search's default radius. */
export const TRIP_RADIUS_MILES = 50;
/** People shown on a shortlist page: a few relevant ones, not the whole city. */
const CANDIDATE_LIMIT = 20;
/** People the AI writes a "why" line for in one call. */
const EXPLAIN_LIMIT = 12;

export async function loadTrip(db: SupabaseClient, id: string): Promise<Trip | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db
    .from("trips")
    .select("id, place_id, starts_on, ends_on, industry_slugs, goal, created_at, places(name, state)")
    .eq("id", id)
    .maybeSingle<Trip>();
  return data;
}

export function tripCity(trip: Pick<Trip, "places">): string {
  return trip.places ? `${trip.places.name}, ${trip.places.state}` : "Destination";
}

/** "Dec 1 – 3, 2026", "Nov 30 – Dec 2, 2026". Dates are calendar days (no time zone shift). */
export function tripDates(trip: Pick<Trip, "starts_on" | "ends_on">): string {
  const parse = (d: string) => new Date(`${d}T12:00:00Z`);
  const start = parse(trip.starts_on);
  const end = parse(trip.ends_on);
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const year = end.getUTCFullYear();
  if (trip.starts_on === trip.ends_on) return `${md(start)}, ${year}`;
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  return `${md(start)} – ${sameMonth ? end.getUTCDate() : md(end)}, ${year}`;
}

/** Alumni near the destination in the chosen industries, in search's relevance order. */
export async function tripCandidates(db: SupabaseClient, trip: Trip): Promise<PersonSummary[]> {
  const { data, error } = await db.rpc("search_people", {
    p_place_id: trip.place_id,
    p_radius_miles: TRIP_RADIUS_MILES,
    p_industry_slugs: trip.industry_slugs.length ? trip.industry_slugs : null,
    p_limit: CANDIDATE_LIMIT,
  });
  if (error) throw error;
  return (data ?? []) as PersonSummary[];
}

const goalHash = (trip: Trip) =>
  createHash("sha256").update(`trip:${trip.id}:${trip.place_id}:${[...trip.industry_slugs].sort().join(",")}:${trip.goal ?? ""}`).digest("hex");

/**
 * One "why this person" line per candidate, tied to the trip's goal (shown as
 * "AI-generated relevance"). Lines are cached per member and trip, so only new
 * candidates reach the AI. If the AI is unavailable, people simply show without
 * a line: nothing is made up to fill the gap.
 */
export async function tripRelevance(db: SupabaseClient, userId: string, trip: Trip, people: PersonSummary[]): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  if (!people.length) return reasons;
  const hash = goalHash(trip);
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
    const goal = [
      trip.goal ?? "Meet relevant alumni",
      `(visiting ${tripCity(trip)}, ${tripDates(trip)})`,
    ].join(" ");
    const { matches } = await getAi().explainMatches(
      goal,
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
    // People the AI skipped are remembered with no line, so revisits don't wait on it again.
    const written = new Map(matches.map((m) => [m.personId, m.why]));
    const rows = missing.map((p, i) => ({
      owner_user_id: userId,
      person_id: p.id,
      goal_hash: hash,
      score: i,
      reasons: written.has(p.id) ? [written.get(p.id)] : [],
    }));
    if (rows.length) await db.from("recommendations").upsert(rows, { onConflict: "owner_user_id,person_id,goal_hash" });
    for (const m of matches) reasons.set(m.personId, m.why);
  } catch (error) {
    console.warn("[trips] relevance lines unavailable:", (error as Error).message.slice(0, 160));
  }
  return reasons;
}

export async function shortlistIds(db: SupabaseClient, tripId: string): Promise<Set<string>> {
  const { data } = await db.from("trip_shortlist").select("person_id").eq("trip_id", tripId);
  return new Set((data ?? []).map((r) => r.person_id as string));
}

const ZONE_BY_STATE: Record<string, string> = {
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  MA: "America/New_York", MD: "America/New_York", ME: "America/New_York", MI: "America/New_York", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", OH: "America/New_York", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", VA: "America/New_York", VT: "America/New_York", WV: "America/New_York",
  IN: "America/New_York", KY: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago", KS: "America/Chicago",
  LA: "America/Chicago", MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago", NE: "America/Chicago",
  ND: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  WI: "America/Chicago",
  CO: "America/Denver", ID: "America/Denver", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  AZ: "America/Phoenix",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  HI: "Pacific/Honolulu",
};

/** The destination's time zone, for calendar invitations (Central if unknown). */
export function tripTimeZone(trip: Pick<Trip, "places">): string {
  return ZONE_BY_STATE[trip.places?.state ?? ""] ?? "America/Chicago";
}
