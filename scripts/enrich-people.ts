// Enriches imported people with UW–Madison degrees, class years, location,
// industry and LinkedIn URL. Sources: the stored bio (from the institution's
// own profile page) plus, if TAVILY_API_KEY is set, web search results.
// Every saved fact is backed by a quote verified against its source.
//
// Usage: npm run enrich -- [--group <slug>] [--names "A,B"] [--limit N] [--concurrency N] [--fresh] [--dry-run] [--no-search]
//   --fresh  clears earlier enrichment results for each person first (after rules change)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { createAi } from "@/lib/ai";
import type { EnrichmentSource } from "@/lib/ai/schemas";
import { findLinkedInUrl, searchConfigured, searchPerson } from "@/lib/enrichment/search";
import { type AlumniStatus, verifyEnrichment } from "@/lib/enrichment/verify";

const CITY_ALIASES: Record<string, string> = { nyc: "New York", "new york city": "New York", la: "Los Angeles", sf: "San Francisco", dc: "Washington", "washington dc": "Washington", "washington, d.c.": "Washington" };

const STATUS_RANK: Record<string, number> = { unknown: 0, not_alumnus: 1, likely: 2, source_stated: 3, confirmed: 4 };
// NVIDIA's free tier allows ~40 requests/minute.
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 1600);

interface PersonRow {
  id: string;
  full_name: string;
  current_title: string | null;
  bio: string | null;
  status: string;
  seniority: string | null;
  alumni_status: string;
  industry_id: number | null;
  place_id: number | null;
  specialties: string[];
  organizations: { name: string } | null;
  person_external_ids: { url: string | null }[];
}

/** Free tiers answer 429 when busy; wait it out (30s, 60s, 90s…) instead of failing the person. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const rateLimited = error instanceof OpenAI.RateLimitError || /\b429\b/.test(String((error as Error).message));
      if (!rateLimited || attempt >= attempts) throw error;
      const waitMs = 30_000 * attempt;
      console.warn(`  rate-limited; waiting ${waitMs / 1000}s (attempt ${attempt}/${attempts - 1})`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadPeople(db: SupabaseClient, groupSlug: string | undefined, limit: number): Promise<PersonRow[]> {
  let query = db
    .from("people")
    .select(
      "id, full_name, current_title, bio, status, seniority, alumni_status, industry_id, place_id, specialties, " +
        "organizations:current_organization_id(name), person_external_ids(url)" +
        (groupSlug ? ", group_memberships!inner(groups!inner(slug))" : ""),
    )
    .eq("status", "seeded") // claimed profiles: the member's own data wins
    .order("full_name")
    .limit(limit);
  if (groupSlug) query = query.eq("group_memberships.groups.slug", groupSlug);
  const { data, error } = await query.returns<PersonRow[]>();
  if (error) throw error;
  return data;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) && !process.argv.includes("--remote")) {
    console.error(`${url || "(unset)"} is not a local Supabase. Pass --remote to enrich there on purpose.`);
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  // One at a time by default: NVIDIA's free tier rate-limits bursts even below 40/min.
  const concurrency = Number(arg("--concurrency") ?? 1);
  const fresh = process.argv.includes("--fresh");
  const useSearch = searchConfigured() && !process.argv.includes("--no-search");
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const ai = createAi();

  if (ai.config.mode === "fixture") {
    console.warn("AI_MODE=fixture: no model is called, so nothing will be extracted. Set AI_MODE=live (see .env.example).");
  }
  console.log(
    `Model: ${ai.config.chat.extract.provider}:${ai.config.chat.extract.model} · web search: ${useSearch ? "on" : "off"} · ${concurrency} at a time${dryRun ? " · dry run" : ""}`,
  );

  const [{ data: industryData }, { data: placeData }, { data: institutionData }] = await Promise.all([
    db.from("industries").select("id, slug, name").returns<{ id: number; slug: string; name: string }[]>(),
    db.from("places").select("id, name, state").returns<{ id: number; name: string; state: string }[]>(),
    db.from("institutions").select("id").eq("slug", "uw-madison").single<{ id: string }>(),
  ]);
  if (!industryData || !placeData || !institutionData) throw new Error("Reference data missing; run migrations first.");
  const industries = industryData;
  const places = placeData;
  const institution = institutionData;
  const industrySlugs = new Set(industries.map((i) => i.slug));

  const onlyNames = arg("--names")?.split(",").map((n) => n.trim().toLowerCase());
  const people = (await loadPeople(db, arg("--group"), Number(arg("--limit") ?? 500))).filter(
    (p) => !onlyNames || onlyNames.includes(p.full_name.toLowerCase()),
  );
  // Alumni-board membership alone makes someone a "likely" alum; that's the baseline --fresh resets to.
  const { data: alumniBoard } = await db
    .from("group_memberships")
    .select("person_id, groups!inner(slug)")
    .eq("groups.slug", "wisconsin-business-alumni-board");
  const alumniBoardIds = new Set((alumniBoard ?? []).map((row) => row.person_id as string));

  async function clearEarlierEnrichment(person: PersonRow) {
    await db.from("educations").delete().eq("person_id", person.id).eq("verified_by", "source");
    await db.from("contact_points").delete().eq("person_id", person.id).eq("source", "web");
    await db.from("field_provenance").delete().eq("person_id", person.id).in("field", ["educations", "alumni_status", "location", "industry_id", "linkedin"]);
    await db.from("enrichment_jobs").delete().eq("person_id", person.id);
    const reset = {
      alumni_status: alumniBoardIds.has(person.id) ? "likely" : "unknown",
      industry_id: null,
      specialties: [],
      place_id: null,
      city: null,
      state: null,
      metro: null,
      location: null,
    };
    await db.from("people").update(reset).eq("id", person.id);
    Object.assign(person, reset);
  }
  const tally: Record<AlumniStatus | "skipped", number> = { source_stated: 0, likely: 0, not_alumnus: 0, unknown: 0, skipped: 0 };

  async function processPerson(person: PersonRow) {
    const organizationName = person.organizations?.name ?? null;
    const profileUrl = person.person_external_ids[0]?.url ?? "about:blank";

    const sources: EnrichmentSource[] = [];
    if (person.bio) sources.push({ id: "S1", url: profileUrl, text: person.bio });
    const bioMentionsWisconsin = /wisconsin|madison/i.test(person.bio ?? "");
    if (useSearch && !bioMentionsWisconsin) {
      try {
        sources.push(...(await searchPerson({ fullName: person.full_name, organizationName }, sources.length + 1)));
      } catch (error) {
        console.warn(`  search failed for ${person.full_name}: ${(error as Error).message}`);
      }
    }
    if (!sources.length) {
      tally.skipped++;
      console.log(`- ${person.full_name}: no bio or search results`);
      if (!dryRun) {
        await db.from("enrichment_jobs").insert({ person_id: person.id, kind: "full", status: "needs_review", provider: "none", attempts: 1, error: "No sources", finished_at: new Date().toISOString() });
      }
      return;
    }

    let enrichment;
    try {
      enrichment = await withRateLimitRetry(() =>
        ai.extractEnrichment({ fullName: person.full_name, title: person.current_title, organizationName, sources, industries }),
      );
    } catch (error) {
      console.warn(`  extraction failed for ${person.full_name}: ${(error as Error).message}`);
      if (!dryRun) {
        await db.from("enrichment_jobs").insert({ person_id: person.id, kind: "full", status: "failed", provider: ai.config.chat.extract.model, attempts: 1, error: (error as Error).message.slice(0, 500), finished_at: new Date().toISOString() });
      }
      return;
    }
    const verified = verifyEnrichment(enrichment, sources, industrySlugs, { seniority: person.seniority });
    const linkedin = useSearch ? await findLinkedInUrl({ fullName: person.full_name, organizationName, title: person.current_title }).catch(() => null) : null;

    tally[verified.alumniStatus]++;
    const degrees = verified.uwEducations.map((e) => [e.degree, e.major && `(${e.major})`, e.gradYear && `'${String(e.gradYear).slice(2)}`].filter(Boolean).join(" "));
    console.log(
      `- ${person.full_name}: ${verified.alumniStatus}${degrees.length ? ` · ${degrees.join("; ")}` : ""}` +
        `${verified.location ? ` · ${verified.location.city}${verified.location.state ? `, ${verified.location.state}` : ""}` : ""}` +
        `${verified.industrySlug ? ` · ${verified.industrySlug}` : ""}${linkedin ? " · LinkedIn" : ""}` +
        `${verified.rejected.length ? ` · dropped: ${verified.rejected.join("; ")}` : ""}`,
    );
    if (dryRun) return;
    // Only now that the new extraction succeeded do we drop the old results.
    if (fresh) await clearEarlierEnrichment(person);

    const fromInstitution = (sourceUrl: string) => sourceUrl === profileUrl;
    const now = new Date().toISOString();
    const provenance: Record<string, unknown>[] = [];

    // Education: replace what earlier enrichment runs wrote; keep roster/self/admin rows.
    // An entry with no degree, major or year says nothing, so it isn't stored.
    const uwEducations = verified.uwEducations.filter((e) => e.degree || e.major || e.gradYear);
    if (uwEducations.length) {
      await db.from("educations").delete().eq("person_id", person.id).eq("verified_by", "source");
      await db.from("educations").insert(
        uwEducations.map((e) => ({
          person_id: person.id,
          institution_id: institution.id,
          school: /bba|mba|business/i.test(`${e.degree} ${e.major}`) ? "Wisconsin School of Business" : null,
          degree: e.degree,
          major: e.major,
          grad_year: e.gradYear,
          verified_by: "source",
        })),
      );
      provenance.push({ field: "educations", sourceUrl: uwEducations[0].sourceUrl, confidence: 0.9 });
    }

    const update: Record<string, unknown> = {};
    // Never downgrade (e.g. alumni-board "likely" stays unless sources say otherwise).
    if (STATUS_RANK[verified.alumniStatus] > STATUS_RANK[person.alumni_status] || (verified.alumniStatus === "not_alumnus" && person.alumni_status === "unknown")) {
      update.alumni_status = verified.alumniStatus;
      if (verified.alumniEvidence) provenance.push({ field: "alumni_status", sourceUrl: verified.alumniEvidence.sourceUrl, confidence: 0.9 });
    }
    if (verified.industrySlug && !person.industry_id) {
      update.industry_id = industries.find((i) => i.slug === verified.industrySlug)!.id;
      provenance.push({ field: "industry_id", sourceUrl: sources[0].url, confidence: 0.7 });
    }
    if (verified.specialties.length && !person.specialties.length) update.specialties = verified.specialties;
    if (verified.location && !person.place_id) {
      // Sources often abbreviate big cities ("NYC"); store the full name.
      const city = CITY_ALIASES[verified.location.city.toLowerCase()] ?? verified.location.city;
      const cityKey = (name: string) => name.toLowerCase().replace(/\s+city$/, "").replace(/^saint\b/, "st.");
      const place = places.find((p) => cityKey(p.name) === cityKey(city) && (!verified.location!.state || p.state === verified.location!.state));
      if (place) update.place_id = place.id;
      else Object.assign(update, { city, state: verified.location.state });
      provenance.push({ field: "location", sourceUrl: verified.location.sourceUrl, confidence: 0.8 });
    }
    if (Object.keys(update).length) await db.from("people").update(update).eq("id", person.id);

    if (linkedin) {
      await db
        .from("contact_points")
        .upsert({ person_id: person.id, kind: "linkedin", value: linkedin, label: "work", source: "web", visibility: "members" }, { onConflict: "person_id,kind,value" });
      provenance.push({ field: "linkedin", sourceUrl: linkedin, confidence: 0.7 });
    }

    if (provenance.length) {
      await db.from("field_provenance").upsert(
        provenance.map((p) => ({
          person_id: person.id,
          field: p.field,
          source: fromInstitution(String(p.sourceUrl)) ? "institution" : "web",
          confidence: p.confidence,
          source_url: p.sourceUrl,
          fetched_at: now,
        })),
        { onConflict: "person_id,field,source" },
      );
    }
    await db.from("enrichment_jobs").insert({
      person_id: person.id,
      kind: "full",
      status: verified.alumniStatus === "unknown" || verified.rejected.length ? "needs_review" : "succeeded",
      provider: enrichment.model,
      attempts: 1,
      error: verified.rejected.length ? `Dropped: ${verified.rejected.join("; ")}`.slice(0, 500) : null,
      finished_at: now,
    });

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  // A few people at a time: free tiers answer slowly (~15s) but allow ~40
  // requests/minute, so parallel workers finish much sooner without exceeding it.
  const queue = [...people];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (let person = queue.shift(); person; person = queue.shift()) await processPerson(person);
    }),
  );

  console.log(
    `\n${people.length} people · UW–Madison stated ${tally.source_stated} · likely ${tally.likely} · not alumni ${tally.not_alumnus} · unknown ${tally.unknown} · no sources ${tally.skipped}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
