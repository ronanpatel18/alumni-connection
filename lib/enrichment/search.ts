// Enrichment searches built on webSearch() (lib/enrichment/providers.ts picks
// the provider: Keenable, Serper, Exa, Linkup, Parallel, Tavily or SearXNG).
import type { EnrichmentSource } from "@/lib/ai/schemas";
import { type SearchResult, webSearch } from "./providers";

export { searchConfigured, searchProvider, searchProviders, webSearch } from "./providers";
export type { SearchOptions, SearchResult } from "./providers";

type TavilyResult = SearchResult;

/** Public pages likely to state where this person studied and lives. */
export async function searchPerson(
  person: { fullName: string; organizationName: string | null },
  firstSourceNumber: number,
): Promise<EnrichmentSource[]> {
  const query = `"${person.fullName}" ${person.organizationName ?? ""} University of Wisconsin`.trim();
  const results = await webSearch(query, { maxResults: 5 });
  // Common names collide (a student and a CIO named Luke Anderson). Keep only pages
  // that also mention the person's employer or the Wisconsin School of Business.
  const orgWords = (person.organizationName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "group", "company", "corporation", "inc", "llc", "partners", "capital", "global", "services"].includes(w));
  const aboutThisPerson = (text: string) => {
    const t = text.toLowerCase();
    return /wisconsin school of business|advisory board/.test(t) || orgWords.some((w) => t.includes(w));
  };
  return results
    .filter((r) => r.url && r.content && !/linkedin\.com\/in\//.test(r.url))
    .filter((r) => aboutThisPerson(`${r.title ?? ""} ${r.content}`))
    .map((r, i) => ({ id: `S${firstSourceNumber + i}`, url: r.url!, text: `${r.title ?? ""}\n${r.content!}`.slice(0, 2500) }));
}

export interface LinkedInResult {
  url: string;
  title: string;
  /** The search snippet: headline, "## Experience", "## Education", "Location: …". */
  content: string;
}

const bareUrl = (url: string) => url.toLowerCase().split("?")[0].replace(/^https?:\/\/([a-z]{2,3}\.)?/, "").replace(/\/$/, "");

/**
 * The wsbcconnect LinkedIn lookup: search "Name Title Company linkedin" on
 * linkedin.com, keep personal profiles (/in/), and score each result: +10 per
 * name part, +5 per job-title word, +15 for the company (+3 per company word
 * on a partial match). wsbcconnect let the person confirm the match; with no
 * one to confirm here, the result's title must carry their first and last
 * name, it must mention their employer, and it must score 30 or more.
 * LinkedIn itself is never fetched.
 */
export async function lookupLinkedIn(person: { fullName: string; organizationName: string | null; title: string | null }): Promise<LinkedInResult | null> {
  const query = [person.fullName, person.title, person.organizationName, "linkedin"].filter(Boolean).join(" ");
  const results = (await webSearch(query, { maxResults: 5, includeDomains: ["linkedin.com"] })).filter((r) => /linkedin\.com\/in\//.test(r.url ?? ""));

  const nameParts = person.fullName.toLowerCase().split(/\s+/).filter((p) => p.length > 2 && !/^[a-z]\.$/.test(p));
  const first = nameParts[0];
  const last = nameParts[nameParts.length - 1];
  const companyWords = (person.organizationName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((w) => w.length > 2 && !["the", "and", "inc", "llc", "group", "company", "corporation", "partners", "capital", "management"].includes(w));
  let best: (LinkedInResult & { score: number; companyHit: boolean }) | null = null;
  for (const r of results) {
    const title = (r.title ?? "").toLowerCase();
    // LinkedIn titles are "Name - Headline": the person's first and last name must be in it.
    if (!first || !title.includes(first) || !title.includes(last)) continue;
    const combined = `${title} ${r.content ?? ""}`.toLowerCase();
    let score = nameParts.filter((p) => combined.includes(p)).length * 10;
    for (const w of (person.title ?? "").toLowerCase().split(/\s+/)) if (w.length > 2 && combined.includes(w)) score += 5;
    const company = (person.organizationName ?? "").toLowerCase();
    const companyHit = Boolean(company && (combined.includes(company) || companyWords.some((w) => combined.includes(w))));
    if (company && combined.includes(company)) score += 15;
    else for (const w of companyWords) if (combined.includes(w)) score += 3;
    if (!best || score > best.score) best = { url: r.url!.split("?")[0], title: r.title ?? "", content: r.content ?? "", score, companyHit };
  }
  // Same name is not enough (two Aimee Londons): the profile must mention their employer.
  if (!best || !best.companyHit || best.score < 30) return null;
  return { url: best.url, title: best.title, content: best.content };
}

/** Back-compat for the enrichment script: just the URL. */
export async function findLinkedInUrl(person: { fullName: string; organizationName: string | null; title: string | null }): Promise<string | null> {
  return (await lookupLinkedIn(person))?.url ?? null;
}

/** The search snippet for a LinkedIn profile we already matched to this person. */
export async function linkedInSnippet(person: { fullName: string; organizationName: string | null }, profileUrl: string): Promise<LinkedInResult | null> {
  const results = await webSearch(`"${person.fullName}" ${person.organizationName ?? ""} linkedin`.trim(), { maxResults: 5, includeDomains: ["linkedin.com"] });
  const hit = results.find((r) => r.url && bareUrl(r.url) === bareUrl(profileUrl));
  return hit ? { url: profileUrl, title: hit.title ?? "", content: hit.content ?? "" } : null;
}

export interface Snippet {
  url: string;
  title: string;
  /** The search snippet. */
  text: string;
  /** The whole page's text, when the search returned it (not for LinkedIn). */
  page: string | null;
}

/** UW–Madison sites that write alumni as "Name (BBA '94)" or "Name ’94". */
const UW_ALUMNI_SITES = ["wisc.edu", "uwalumni.com", "supportuw.org", "allwaysforward.org", "uwbadgers.com"];

/**
 * Three searches aimed at class years: (1) any page tying the person to UW
 * with a degree word, (2) UW–Madison's own sites (news, alumni magazine,
 * foundation, awards), both returning full page text, and (3) LinkedIn search
 * snippets, whose education lines often show "University of Wisconsin-Madison
 * · 1993 – 1997" (LinkedIn is read only through snippets, never fetched).
 * A result is kept only if it's about this person: their full name plus their
 * employer, the business school, a UW site, or (LinkedIn) the profile URL we
 * already matched to them.
 */
export async function searchClassYearSnippets(
  person: {
    fullName: string;
    organizationName: string | null;
    linkedinUrl: string | null;
  },
  // LinkedIn snippets rarely carry education years, so that third search is off by default.
  { includeLinkedIn = false }: { includeLinkedIn?: boolean } = {},
): Promise<Snippet[]> {
  // Only download pages whose title or snippet names them alongside something
  // that could carry a class year; data-broker and namesake pages are skipped.
  const surname = person.fullName.toLowerCase().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/.test(w)).pop() ?? "";
  const worthReading = (r: { title?: string; content?: string }) => {
    const text = `${r.title ?? ""} ${r.content ?? ""}`.toLowerCase();
    return text.includes(surname) && /wisconsin|\buw\b|badger|\bbba\b|\bmba\b|class of|alum|graduat/.test(text);
  };
  const [general, uwSites, linkedin] = await Promise.all([
    webSearch(`"${person.fullName}" "University of Wisconsin" (graduated OR "class of" OR BBA OR MBA OR alumnus OR alumna)`, {
      maxResults: 6,
      rawContent: worthReading,
    }),
    webSearch(`"${person.fullName}" (BBA OR MBA OR alumni OR "class of")`, { maxResults: 6, includeDomains: UW_ALUMNI_SITES, rawContent: worthReading }),
    includeLinkedIn
      ? webSearch(`"${person.fullName}" "University of Wisconsin-Madison" ${person.organizationName ?? ""}`.trim(), {
          maxResults: 5,
          includeDomains: ["linkedin.com"],
        })
      : Promise.resolve([]),
  ]);

  const nameParts = person.fullName
    .toLowerCase()
    .replace(/\b[a-z]\.\s*/g, "")
    .split(/\s+/)
    .filter((p) => p.length > 1);
  const orgWords = (person.organizationName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "group", "company", "corporation", "inc", "llc", "partners", "capital", "global"].includes(w));
  const knownProfile = person.linkedinUrl?.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");
  const bare = (url: string) => url.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");

  const keep = (r: TavilyResult, kind: "general" | "uw" | "linkedin") => {
    if (!r.url || !r.content) return false;
    const text = `${r.title ?? ""} ${r.content} ${(r.raw_content ?? "").slice(0, 50_000)}`.toLowerCase();
    if (!nameParts.every((p) => text.includes(p))) return false;
    if (kind === "linkedin") return Boolean(knownProfile && bare(r.url).includes(knownProfile)) || orgWords.some((w) => text.includes(w));
    if (kind === "uw") return true; // a UW–Madison site naming them in full
    return /wisconsin school of business|advisory board/.test(text) || orgWords.some((w) => text.includes(w));
  };

  const seen = new Set<string>();
  const results: Snippet[] = [];
  const push = (r: TavilyResult, kind: "general" | "uw" | "linkedin") => {
    if (seen.has(bare(r.url!)) || !keep(r, kind)) return;
    seen.add(bare(r.url!));
    results.push({ url: r.url!, title: r.title ?? "", text: `${r.title ?? ""}\n${r.content!}`, page: kind === "linkedin" ? null : (r.raw_content ?? null) });
  };
  for (const r of uwSites) push(r, "uw");
  for (const r of general.filter((x) => !/linkedin\.com/.test(x.url ?? ""))) push(r, "general");
  for (const r of linkedin.filter((x) => /linkedin\.com\/in\//.test(x.url ?? ""))) push(r, "linkedin");
  return results;
}

/** Wikidata: "educated at University of Wisconsin–Madison" with an end date, for well-known alumni. */
export async function wikidataClassYears(fullName: string): Promise<{ year: number; degree: string | null; url: string }[]> {
  const name = fullName.replace(/["\\]/g, "");
  const query = `SELECT ?p ?end ?degreeLabel WHERE {
    ?p rdfs:label "${name}"@en; wdt:P31 wd:Q5; p:P69 ?st.
    ?st ps:P69 ?school. ?school rdfs:label "University of Wisconsin–Madison"@en.
    OPTIONAL { ?st pq:P582 ?end } OPTIONAL { ?st pq:P512 ?degree }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 10`;
  const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "AlumniConnect/0.1 (alumni directory; local development)" },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { results: { bindings: { p: { value: string }; end?: { value: string }; degreeLabel?: { value: string } }[] } };
  const rows = body.results.bindings;
  // Two different people with this name: can't tell which one, so use neither.
  if (new Set(rows.map((r) => r.p.value)).size !== 1) return [];
  return rows
    .filter((r) => r.end)
    .map((r) => ({ year: Number(r.end!.value.slice(0, 4)), degree: r.degreeLabel?.value ?? null, url: r.p.value.replace("http://", "https://") }));
}
