// Finds UW–Madison class years for people who don't have one yet, from
// (1) their stored bio, (2) Wikidata, (3) free web sources: UW–Madison's own
// sites (WSB, news, the alumni magazine, the foundation, engineering) and
// Wikipedia, and (4) three web searches through self-hosted SearXNG
// (npm run search:start), or Tavily with --tavily (spends its monthly quota).
// Only years the text states outright are used, each saved with its source.
// Fields a member or an administrator set are never touched.
//
// Usage: npm run class-years -- [--write] [--names "A,B"] [--no-search] [--tavily] [--limit N]
//   Without --write it only reports what it would save.
import { createClient } from "@supabase/supabase-js";
import {
  chooseClassYears,
  type ClassYearFinding,
  findClassYears,
} from "@/lib/enrichment/class-year";
import { searchUwSites, searchWikipedia } from "@/lib/enrichment/free-sources";
import {
  type Snippet,
  searchClassYearSnippets,
  searchConfigured,
  searchProvider,
  wikidataClassYears,
} from "@/lib/enrichment/search";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const write = process.argv.includes("--write");
const useFreeSearch = !process.argv.includes("--no-search");
// Web search goes through self-hosted SearXNG (free); --tavily uses Tavily's quota instead.
if (process.argv.includes("--tavily")) process.env.SEARCH_PROVIDER = "tavily";
const useWebSearch = useFreeSearch && searchConfigured();
const names = arg("--names")
  ?.split(",")
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);
const limit = Number(arg("--limit") ?? Infinity);

const SENIOR = new Set([
  "c_suite",
  "vp",
  "director",
  "partner",
  "owner",
  "founder",
  "senior",
]);
const WIKIDATA_DEGREES: [RegExp, string][] = [
  [/master of business administration/i, "MBA"],
  [/bachelor of business administration/i, "BBA"],
  [/bachelor of science/i, "BS"],
  [/bachelor of arts/i, "BA"],
  [/master of science/i, "MS"],
  [/master of arts/i, "MA"],
  [/juris doctor/i, "JD"],
  [/doctor of philosophy/i, "PhD"],
];

interface Person {
  id: string;
  full_name: string;
  bio: string | null;
  seniority: string | null;
  alumni_status: string;
  organizations: { name: string } | null;
  educations: {
    id: string;
    degree: string | null;
    grad_year: number | null;
    verified_by: string | null;
  }[];
  contact_points: { kind: string; value: string }[];
  field_provenance: {
    field: string;
    source: string;
    source_url: string | null;
  }[];
}

const lastName = (fullName: string) =>
  fullName
    .split(/\s+/)
    .filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w))
    .pop()!
    .toLowerCase();

const firstName = (fullName: string) =>
  fullName
    .split(/\s+/)
    .find((w) => !/^[A-Z]\.$/.test(w))!
    .toLowerCase();

type Found = ClassYearFinding & {
  url: string;
  from: "bio" | "wikidata" | "web";
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", {
    auth: { persistSession: false },
  });
  const { data, error } = await db
    .from("people")
    .select(
      "id, full_name, bio, seniority, alumni_status, organizations:current_organization_id(name), " +
        "educations(id, degree, grad_year, verified_by), contact_points(kind, value), field_provenance(field, source, source_url)",
    )
    .is("claimed_by_user_id", null)
    .neq("alumni_status", "not_alumnus")
    .order("full_name")
    .returns<Person[]>();
  if (error) throw error;

  const candidates = data
    .filter((p) => !p.educations.some((e) => e.grad_year))
    .filter(
      (p) =>
        !p.field_provenance.some(
          (f) =>
            f.field === "educations" &&
            (f.source === "admin" || f.source === "self"),
        ),
    )
    .filter((p) => !names || names.includes(p.full_name.toLowerCase()))
    .slice(0, limit);

  console.log(
    `${candidates.length} people without a class year. Free web sources: ${useFreeSearch ? "on" : "off"}. Web search: ${useWebSearch ? searchProvider() : "off"}. ${write ? "Saving results." : "Dry run (add --write to save)."}\n`,
  );
  const currentYear = new Date().getFullYear();
  let foundCount = 0;

  // Several people at once: searches rotate across engines, so this keeps them all busy.
  const CONCURRENCY = Number(arg("--concurrency") ?? 5);
  const work = async (person: Person) => {
    const log: string[] = [];
    try {
      const found: Found[] = [];
      const listingUrl = person.field_provenance.find(
        (f) => f.field === "bio" && f.source === "institution",
      )?.source_url;

      // 1. The bio. On the person's UW–Madison profile page, "BBA 1951" needs no "Wisconsin" next to it.
      if (person.bio) {
        const about = { fullName: person.full_name, pageIsAboutThem: true };
        for (const f of findClassYears(person.bio, {
          uwContext: Boolean(listingUrl),
          about,
        }))
          found.push({ ...f, url: listingUrl ?? "", from: "bio" });
      }

      // 2. Wikidata (well-known alumni).
      try {
        for (const w of await wikidataClassYears(person.full_name)) {
          const degree =
            WIKIDATA_DEGREES.find(
              ([re]) => w.degree && re.test(w.degree),
            )?.[1] ?? null;
          found.push({
            year: w.year,
            degree,
            kind: "stated",
            quote: `Wikidata: educated at University of Wisconsin–Madison, ended ${w.year}`,
            url: w.url,
            from: "wikidata",
          });
        }
      } catch (e) {
        console.warn(
          `  Wikidata lookup failed for ${person.full_name}: ${(e as Error).message}`,
        );
      }

      // 3. Free web sources (no key, no cost): UW–Madison's own sites and Wikipedia.
      //    Then, only if asked (--tavily) and still nothing, Tavily's paid-quota search.
      const readPages = (snippets: Snippet[]) => {
        for (const s of snippets) {
          // A page "about them" has their name in its title (their Wikipedia article, an award story).
          // (First and last name: Jon Hammes's article isn't about Patrick Hammes.)
          const title = s.title.toLowerCase();
          const about = {
            fullName: person.full_name,
            pageIsAboutThem:
              title.includes(lastName(person.full_name)) &&
              title.includes(firstName(person.full_name)),
          };
          const fromPage = s.page
            ? findClassYears(s.page.slice(0, 60_000), { about })
            : [];
          for (const f of [...findClassYears(s.text, { about }), ...fromPage])
            found.push({ ...f, url: s.url, from: "web" });
        }
      };
      if (!found.length && useFreeSearch) {
        const [uw, wiki] = await Promise.all([
          searchUwSites(person.full_name),
          searchWikipedia(person.full_name),
        ]);
        readPages([...uw, ...wiki]);
      }
      if (!found.length && useWebSearch) {
        try {
          readPages(
            await searchClassYearSnippets({
              fullName: person.full_name,
              organizationName: person.organizations?.name ?? null,
              linkedinUrl:
                person.contact_points.find((c) => c.kind === "linkedin")
                  ?.value ?? null,
            }),
          );
        } catch (e) {
          console.warn(
            `  web search failed for ${person.full_name}: ${(e as Error).message}`,
          );
        }
      }

      // A senior executive graduating in the last few years is almost certainly a namesake.
      const plausible = found.filter(
        (f) =>
          !(
            person.seniority &&
            SENIOR.has(person.seniority) &&
            f.year > currentYear - 5
          ),
      );
      const chosen = chooseClassYears(plausible) as Found[];
      if (!chosen.length) {
        log.push(
          `· ${person.full_name}: none found${found.length > plausible.length ? " (implausible years skipped)" : found.length ? " (sources disagree)" : ""}`,
        );
        return;
      }
      foundCount++;
      for (const c of chosen) {
        log.push(
          `✓ ${person.full_name}: ${c.degree ?? "degree"} ${c.year} (${c.from}${c.kind === "range" ? ", date range" : ""})\n    “${c.quote}”\n    ${c.url}`,
        );
      }
      if (!write) return;

      for (const c of chosen) {
        // Fill a matching undated degree if there is one; otherwise add the degree.
        const target =
          person.educations.find(
            (e) =>
              !e.grad_year &&
              c.degree &&
              e.degree?.replace(/\./g, "").toUpperCase() === c.degree,
          ) ??
          (person.educations.filter((e) => !e.grad_year).length === 1 &&
          !c.degree
            ? person.educations.find((e) => !e.grad_year)
            : undefined);
        if (target) {
          await db
            .from("educations")
            .update({ grad_year: c.year })
            .eq("id", target.id);
          target.grad_year = c.year;
        } else {
          await db.from("educations").insert({
            person_id: person.id,
            institution_id: (
              await db
                .from("people")
                .select("institution_id")
                .eq("id", person.id)
                .single()
            ).data!.institution_id,
            degree: c.degree,
            grad_year: c.year,
            school:
              c.degree && /BBA|MBA/.test(c.degree)
                ? "Wisconsin School of Business"
                : null,
            verified_by: "source",
          });
        }
      }
      const best = chosen[0];
      await db.from("field_provenance").upsert(
        {
          person_id: person.id,
          field: "educations",
          source: best.from === "bio" ? "institution" : "web",
          confidence: best.kind === "range" ? 0.75 : 0.9,
          source_url: best.url || null,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "person_id,field,source" },
      );
      // A source stating a UW–Madison class year also states the degree.
      if (
        ["likely", "unknown"].includes(person.alumni_status) &&
        chosen.some((c) => c.kind === "stated")
      ) {
        await db
          .from("people")
          .update({ alumni_status: "source_stated" })
          .eq("id", person.id);
      }
    } finally {
      if (log.length) console.log(log.join("\n"));
    }
  };
  const queue = [...candidates];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let person = queue.shift(); person; person = queue.shift())
        await work(person);
    }),
  );

  console.log(
    `\nClass years found for ${foundCount} of ${candidates.length}.${write ? "" : " Nothing saved (dry run)."}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
