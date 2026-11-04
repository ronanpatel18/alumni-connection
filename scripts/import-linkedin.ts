// Pulls LinkedIn data the way wsbcconnect did: through LinkedIn's public
// search snippets (via self-hosted SearXNG, or Tavily), never by fetching LinkedIn. For each unclaimed
// profile it
//   1. finds the LinkedIn profile URL if we don't have one (wsbcconnect's query and scoring),
//   2. reads that profile's snippet: location, dated work history, education,
//   3. fills what's missing: location, past positions and start dates, UW degrees,
//      and moves the current role when LinkedIn shows the listed job has ended.
// Fields a member or an administrator set are never touched.
//
// Usage: npm run linkedin -- [--write] [--names "A,B"] [--limit N]
//   Without --write it only reports what it would change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { degreeFromDetails, isUwMadison, type LinkedInPosition, parseLinkedInSnippet } from "@/lib/enrichment/linkedin";
import { linkedInSnippet, lookupLinkedIn, searchConfigured } from "@/lib/enrichment/search";
import { seniorityFor } from "@/lib/importers/wsb-boards";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const write = process.argv.includes("--write");
const names = arg("--names")
  ?.split(",")
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);
const limit = Number(arg("--limit") ?? Infinity);

// Snippets are cached for a week (git-ignored) so a dry run and the saving run
// don't spend the free search quota twice.
const CACHE_FILE = "data/private/linkedin-snippets.json";
const CACHE_DAYS = 7;
type Cached = { at: string; result: { url: string; title: string; content: string } | null };
const cache: Record<string, Cached> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
const fresh = (c: Cached | undefined) => c && Date.now() - Date.parse(c.at) < CACHE_DAYS * 86_400_000;
async function cached<T extends Cached["result"]>(key: string, load: () => Promise<T>): Promise<T> {
  if (fresh(cache[key])) return cache[key].result as T;
  const result = await load();
  cache[key] = { at: new Date().toISOString(), result };
  mkdirSync("data/private", { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  return result;
}

interface Person {
  id: string;
  full_name: string;
  current_title: string | null;
  current_organization_id: string | null;
  place_id: number | null;
  city: string | null;
  alumni_status: string;
  institution_id: string;
  organizations: { name: string } | null;
  positions: { id: string; title: string; organization_name: string; is_current: boolean; start_date: string | null }[];
  educations: { id: string; degree: string | null }[];
  contact_points: { kind: string; value: string }[];
  field_provenance: { field: string; source: string }[];
}

const STOP = new Set(["the", "inc", "llc", "lp", "l.p.", "co", "corp", "corporation", "company", "group", "&", "and", "of", "partners", "capital", "management"]);
const orgWords = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
/** "Ernst & Young LLP" ≈ "EY" isn't caught, but "Marriott" ≈ "Marriott International" and "Alera Group, Inc." ≈ "Alera Group" are. */
function sameOrg(a: string, b: string): boolean {
  const wa = orgWords(a);
  const wb = orgWords(b);
  if (!wa.length || !wb.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return wa[0] === wb[0] || wa.join(" ") === wb.join(" ");
}
// Side roles that shouldn't replace someone's main job.
const SIDE_ROLE = /\b(board|advisor|adviser|member|volunteer|trustee|mentor|chair of|investor|fellow)\b/i;

async function main() {
  if (!searchConfigured()) {
    console.error("No web search configured: run npm run search:start (SearXNG), or set SEARCH_PROVIDER=tavily and TAVILY_API_KEY.");
    process.exit(1);
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const [{ data, error }, { data: places }] = await Promise.all([
    db
      .from("people")
      .select(
        "id, full_name, current_title, current_organization_id, place_id, city, alumni_status, institution_id, organizations:current_organization_id(name), " +
          "positions(id, title, organization_name, is_current, start_date), educations(id, degree), contact_points(kind, value), field_provenance(field, source)",
      )
      .is("claimed_by_user_id", null)
      .neq("status", "opted_out")
      .order("full_name")
      .returns<Person[]>(),
    db.from("places").select("id, name, state"),
  ]);
  if (error) throw error;
  const people = data.filter((p) => !names || names.includes(p.full_name.toLowerCase())).slice(0, limit);
  console.log(`${people.length} profiles. ${write ? "Saving changes." : "Dry run (add --write to save)."}\n`);

  const tally = { urls: 0, snippets: 0, locations: 0, positions: 0, roles: 0, degrees: 0 };
  const now = new Date().toISOString();

  for (const person of people) {
    const protectedFields = new Set(person.field_provenance.filter((f) => f.source === "admin" || f.source === "self").map((f) => f.field));
    const employer = person.organizations?.name ?? null;
    const changes: string[] = [];
    const provenance: { field: string; confidence: number }[] = [];
    let profileUrl = person.contact_points.find((c) => c.kind === "linkedin")?.value ?? null;

    // 1–2. Find the profile and its snippet.
    let snippet;
    try {
      if (profileUrl) {
        const url = profileUrl;
        snippet = await cached(`snippet:${url}`, () => linkedInSnippet({ fullName: person.full_name, organizationName: employer }, url));
      } else {
        snippet = await cached(`lookup:${person.id}`, () =>
          lookupLinkedIn({ fullName: person.full_name, organizationName: employer, title: person.current_title }),
        );
        if (snippet) {
          profileUrl = snippet.url;
          tally.urls++;
          changes.push(`LinkedIn: ${profileUrl}`);
          if (write) {
            await db
              .from("contact_points")
              .upsert(
                { person_id: person.id, kind: "linkedin", value: profileUrl, label: "work", source: "web", visibility: "members" },
                { onConflict: "person_id,kind,value" },
              );
            provenance.push({ field: "linkedin", confidence: 0.7 });
          }
        }
      }
    } catch (e) {
      console.warn(`  search failed for ${person.full_name}: ${(e as Error).message}`);
      continue;
    }
    if (!snippet?.content || !profileUrl) {
      console.log(`· ${person.full_name}: ${profileUrl ? "no snippet for the profile" : "no LinkedIn profile found"}`);
      continue;
    }
    tally.snippets++;
    const parsed = parseLinkedInSnippet(snippet.content);

    // 3a. Location, only where we have none.
    if (parsed.location && !person.place_id && !person.city && !protectedFields.has("location")) {
      const loc = parsed.location;
      const place = places?.find((p) => p.name.toLowerCase() === loc.city.toLowerCase() && (!loc.state || p.state === loc.state));
      changes.push(`location: ${loc.city}${loc.state ? `, ${loc.state}` : ""}${place ? " (listed city)" : ""}`);
      tally.locations++;
      if (write) {
        await db.from("people").update(place ? { place_id: place.id } : { city: loc.city, state: loc.state }).eq("id", person.id);
        provenance.push({ field: "location", confidence: 0.8 });
      }
    }

    // 3b. Work history.
    const roleProtected = protectedFields.has("current_title") || protectedFields.has("current_organization_id");
    const handled = new Set<LinkedInPosition>();
    if (employer && !roleProtected) {
      const listed = person.positions.find((p) => p.is_current && sameOrg(p.organization_name, employer));
      const stillThere = parsed.experience.find((e) => e.isCurrent && sameOrg(e.organization, employer));
      const ended = parsed.experience.find((e) => !e.isCurrent && sameOrg(e.organization, employer));
      const main = parsed.experience.find((e) => e.isCurrent && !SIDE_ROLE.test(e.title));
      if (stillThere) {
        handled.add(stillThere);
        if (listed && !listed.start_date && stillThere.startDate) {
          changes.push(`current role started ${stillThere.startDate.slice(0, 7)}`);
          if (write) await db.from("positions").update({ start_date: stillThere.startDate }).eq("id", listed.id);
        }
      } else if (ended && main) {
        // The listed job has ended on LinkedIn: their current job is the newer one.
        handled.add(ended).add(main);
        tally.roles++;
        changes.push(`role: "${person.current_title} at ${employer}" ended ${ended.endDate?.slice(0, 7) ?? "?"}; now "${main.title} at ${main.organization}"`);
        if (write) {
          if (listed) await db.from("positions").update({ is_current: false, start_date: ended.startDate, end_date: ended.endDate }).eq("id", listed.id);
          let orgId = (await db.from("organizations").select("id").ilike("name", main.organization).limit(1).maybeSingle()).data?.id;
          orgId ??= (await db.from("organizations").insert({ name: main.organization }).select("id").single()).data!.id;
          await db.from("positions").insert({
            person_id: person.id,
            organization_id: orgId,
            organization_name: main.organization,
            title: main.title,
            start_date: main.startDate,
            is_current: true,
          });
          await db
            .from("people")
            .update({
              current_title: main.title,
              current_organization_id: orgId,
              headline: `${main.title} at ${main.organization}`,
              seniority: seniorityFor(main.title),
            })
            .eq("id", person.id);
          provenance.push({ field: "current_title", confidence: 0.75 }, { field: "current_organization_id", confidence: 0.75 });
        }
      }
    }
    const newPositions = parsed.experience.filter(
      (e) =>
        !handled.has(e) &&
        // "Speaker at Matt Apps" (themselves) and "MBA Candidate at UW–Madison" (school, not a job).
        e.organization.toLowerCase() !== person.full_name.toLowerCase() &&
        !/\b(candidate|student)\b/i.test(e.title) &&
        !person.positions.some((p) => p.title.toLowerCase() === e.title.toLowerCase() && sameOrg(p.organization_name, e.organization)),
    );
    if (newPositions.length && !protectedFields.has("positions")) {
      tally.positions += newPositions.length;
      changes.push(`+${newPositions.length} positions (${newPositions.map((e) => `${e.title} at ${e.organization}`).join("; ")})`);
      if (write) {
        await db.from("positions").insert(
          newPositions.map((e) => ({
            person_id: person.id,
            organization_name: e.organization,
            title: e.title,
            start_date: e.startDate,
            end_date: e.endDate,
            is_current: e.isCurrent,
          })),
        );
        provenance.push({ field: "positions", confidence: 0.75 });
      }
    }

    // 3c. UW–Madison education.
    const uw = parsed.education.filter((e) => isUwMadison(e.school));
    if (uw.length && !protectedFields.has("educations")) {
      for (const entry of uw) {
        const { degree, major } = degreeFromDetails(entry.details);
        const have = person.educations.some((e) => (e.degree ?? "").replace(/\./g, "").toUpperCase() === (degree ?? "").toUpperCase());
        if ((degree && !have) || person.educations.length === 0) {
          tally.degrees++;
          changes.push(`UW degree: ${degree ?? "degree not named"}${major ? `, ${major}` : ""}`);
          if (write) {
            await db.from("educations").insert({
              person_id: person.id,
              institution_id: person.institution_id,
              degree,
              major,
              school: /business/i.test(entry.school) || /BBA|MBA|MAcc/.test(degree ?? "") ? "Wisconsin School of Business" : null,
              verified_by: "source",
            });
            person.educations.push({ id: "new", degree });
            provenance.push({ field: "educations", confidence: 0.75 });
          }
        }
      }
      if (["likely", "unknown"].includes(person.alumni_status)) {
        changes.push("alumni status: a source states a UW–Madison degree");
        if (write) {
          await db.from("people").update({ alumni_status: "source_stated" }).eq("id", person.id);
          provenance.push({ field: "alumni_status", confidence: 0.75 });
        }
      }
    }

    if (write && provenance.length) {
      await db.from("field_provenance").upsert(
        [...new Map(provenance.map((p) => [p.field, p])).values()].map((p) => ({
          person_id: person.id,
          field: p.field,
          source: "web",
          confidence: p.confidence,
          source_url: profileUrl,
          fetched_at: now,
        })),
        { onConflict: "person_id,field,source" },
      );
    }
    console.log(changes.length ? `✓ ${person.full_name}\n    ${changes.join("\n    ")}` : `· ${person.full_name}: nothing new`);
  }

  console.log(
    `\nProfiles found: ${tally.urls} new · snippets read: ${tally.snippets} · locations: ${tally.locations} · ` +
      `past/side positions: ${tally.positions} · updated roles: ${tally.roles} · UW degrees: ${tally.degrees}.${write ? "" : " Nothing saved (dry run)."}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
