// From a name to a profile: finds a UW–Madison alum's class year, work history
// and location on the public web. Used when an administrator adds someone by
// name (app/(member)/admin/people) and by `npm run add-people`.
//
// 1. Three searches, each sent to every configured provider at once
//    (lib/enrichment/providers.ts): pages tying the name to UW–Madison,
//    UW–Madison's own sites, and LinkedIn profiles (read through the search
//    providers' own copies; LinkedIn itself is never fetched).
// 2. Only pages about this person are kept: their full name plus UW–Madison or
//    something the administrator said about them. Two LinkedIn profiles that
//    fit equally well means we can't tell who's who, so neither is used.
// 3. Facts come from plain patterns (class years, LinkedIn's layout) and from
//    the model; every model fact needs a quote found in its source.
// Nothing here writes to the database: see save-person.ts.
import type { Ai, EnrichmentSource } from "@/lib/ai";
import { chooseClassYears, type ClassYearFinding, findClassYears } from "./class-year";
import { degreeFromDetails, isUwMadison, parseLinkedInSnippet, US_STATES } from "./linkedin";
import { type SearchResult, webSearch } from "./providers";
import { type AlumniStatus, findSource, normalizeDegree, verifyEnrichment } from "./verify";

export interface LookupInput {
  fullName: string;
  /** Anything the administrator knows: an employer, a city, a class year. */
  hint?: string | null;
  title?: string | null;
  organizationName?: string | null;
  /** A profile already matched to them. */
  linkedinUrl?: string | null;
}

export interface FoundEducation {
  degree: string | null;
  major: string | null;
  gradYear: number | null;
  sourceUrl: string;
  /** The words the degree or year was read from. */
  quote: string;
}

export interface FoundPosition {
  title: string;
  organization: string;
  /** YYYY-MM-01 */
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  sourceUrl: string;
}

export interface PersonFindings {
  linkedinUrl: string | null;
  alumniStatus: AlumniStatus;
  alumniSourceUrl: string | null;
  educations: FoundEducation[];
  positions: FoundPosition[];
  location: { city: string; state: string | null; sourceUrl: string } | null;
  industrySlug: string | null;
  specialties: string[];
  /** Pages the facts were read from. */
  sources: { url: string; title: string }[];
  /** Things an administrator should know (nothing found, namesakes, dropped claims). */
  notes: string[];
  model: string | null;
}

/** UW–Madison sites that write alumni as "Name (BBA '94)" or "Name ’94". */
const UW_SITES = ["wisc.edu", "uwalumni.com", "supportuw.org", "allwaysforward.org", "uwbadgers.com"];
const UW_WORDS = /university of wisconsin|uw[\s–—-]*madison|wisconsin[\s–—-]+madison|wisconsin school of business|\bbadgers?\b/i;
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|md|jd|mba|cfa|cpa)\.?$/i;
const HINT_STOP = new Set(["the", "and", "inc", "llc", "group", "company", "corporation", "partners", "class", "university", "wisconsin", "madison", "from", "with", "works", "lives"]);
// Side roles that shouldn't be taken for someone's main job.
export const SIDE_ROLE = /\b(board|advisor|adviser|member|volunteer|trustee|mentor|chair of|investor|fellow)\b/i;

const ORG_STOP = new Set(["the", "inc", "llc", "lp", "l.p.", "co", "corp", "corporation", "company", "group", "&", "and", "of", "partners", "capital", "management"]);
const orgWords = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !ORG_STOP.has(w));
/** "Marriott" ≈ "Marriott International", "Alera Group, Inc." ≈ "Alera Group". */
export function sameOrg(a: string, b: string): boolean {
  const wa = orgWords(a);
  const wb = orgWords(b);
  if (!wa.length || !wb.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return wa[0] === wb[0] || wa.join(" ") === wb.join(" ");
}

function nameWords(fullName: string): { first: string; last: string } {
  const words = fullName
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NAME_SUFFIX.test(w));
  return { first: words[0] ?? "", last: words[words.length - 1] ?? "" };
}

const bare = (url: string) => url.toLowerCase().split(/[?#]/)[0].replace(/^https?:\/\/(www\.|[a-z]{2}\.)?/, "").replace(/\/$/, "");
const isLinkedInProfile = (url: string) => /linkedin\.com\/in\//i.test(url);
const onUwSite = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return UW_SITES.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

/** The part of a long page that's about them: the text around each mention of their surname. */
function aroundName(text: string, last: string, budget: number): string {
  if (text.length <= budget) return text;
  const lower = text.toLowerCase();
  const windows: [number, number][] = [];
  for (let at = lower.indexOf(last); at >= 0 && windows.length < 12; at = lower.indexOf(last, at + last.length)) {
    const start = Math.max(0, at - 500);
    const end = Math.min(text.length, at + 900);
    const previous = windows[windows.length - 1];
    if (previous && start <= previous[1]) previous[1] = end;
    else windows.push([start, end]);
  }
  if (!windows.length) return text.slice(0, budget);
  return windows
    .map(([s, e]) => text.slice(s, e))
    .join("\n…\n")
    .slice(0, budget);
}

interface Kept {
  result: SearchResult & { url: string };
  kind: "linkedin" | "uw" | "web";
  text: string;
  score: number;
}

// An old article's "is the CEO of" says nothing about today: a job counts as
// current only on a LinkedIn profile or a page published this recently.
const CURRENT_WITHIN_MS = 2 * 365 * 86_400_000;
const isRecent = (published: string | null | undefined) => Boolean(published) && Date.now() - Date.parse(published!) < CURRENT_WITHIN_MS;
const dated = (r: SearchResult, text: string) => (r.published ? `Published: ${r.published}\n${text}` : text);

/** Free model tiers refuse a burst now and then: one more try after a pause. */
async function twice<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return run();
  }
}

/** Searches, then keeps the pages that are about this person. Exported for tests. */
export function selectSources(input: LookupInput, results: SearchResult[]): { kept: Kept[]; linkedin: Kept | null; notes: string[] } {
  const { first, last } = nameWords(input.fullName);
  const hintWords = `${input.hint ?? ""} ${input.organizationName ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9&']+/)
    .filter((w) => w.length >= 3 && !HINT_STOP.has(w) && w !== first && w !== last);
  const knownProfile = input.linkedinUrl ? bare(input.linkedinUrl) : null;
  const notes: string[] = [];
  const kept: Kept[] = [];
  const profiles: Kept[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    if (!r.url || seen.has(bare(r.url))) continue;
    const title = (r.title ?? "").toLowerCase();
    const body = `${r.content ?? ""}\n${(r.raw_content ?? "").slice(0, 60_000)}`;
    const all = `${title}\n${body}`.toLowerCase();
    if (!first || !all.includes(first) || !all.includes(last)) continue;
    const hintHits = hintWords.filter((w) => all.includes(w)).length;
    const score = (UW_WORDS.test(all) ? 2 : 0) + hintHits * 2 + (body.length > 400 ? 1 : 0);

    if (/linkedin\.com/i.test(r.url)) {
      // Company pages, posts and directories of namesakes say nothing reliable about one person.
      if (!isLinkedInProfile(r.url)) continue;
      const isKnown = knownProfile === bare(r.url);
      // LinkedIn titles are "Name - Headline": theirs must carry their first and last name.
      if (!isKnown && (!title.includes(first) || !title.includes(last))) continue;
      if (!isKnown && !UW_WORDS.test(all) && !hintHits) continue;
      seen.add(bare(r.url));
      profiles.push({ result: r as Kept["result"], kind: "linkedin", text: `${r.title ?? ""}\n${r.raw_content ?? r.content ?? ""}`.slice(0, 8000), score: score + (isKnown ? 100 : 0) });
      continue;
    }
    const uwSite = onUwSite(r.url);
    if (!uwSite && !UW_WORDS.test(all) && !hintHits) continue;
    seen.add(bare(r.url));
    const page = r.raw_content ? aroundName(r.raw_content, last, 5000) : "";
    kept.push({ result: r as Kept["result"], kind: uwSite ? "uw" : "web", text: dated(r, `${r.title ?? ""}\n${r.content ?? ""}\n${page}`.trim()), score: score + (uwSite ? 2 : 0) });
  }

  profiles.sort((a, b) => b.score - a.score);
  let linkedin: Kept | null = profiles[0] ?? null;
  if (profiles.length > 1 && profiles[1].score >= profiles[0].score) {
    linkedin = null;
    notes.push(`${profiles.length} LinkedIn profiles fit this name equally well, so none was used. Add an employer or city and search again.`);
  }
  kept.sort((a, b) => b.score - a.score);
  return { kept: [...(linkedin ? [linkedin] : []), ...kept.slice(0, 7)], linkedin, notes };
}

const yearDate = (year: number | null) => (year ? `${year}-01-01` : null);

function addPosition(positions: FoundPosition[], next: FoundPosition) {
  if (!next.title.trim() || !next.organization.trim()) return;
  if (/\b(candidate|student|intern(ship)?)\b/i.test(next.title)) return;
  const same = positions.find((p) => sameOrg(p.organization, next.organization) && p.title.toLowerCase() === next.title.toLowerCase());
  if (!same) positions.push(next);
  else {
    same.startDate ??= next.startDate;
    same.endDate ??= next.endDate;
    same.isCurrent ||= next.isCurrent && !same.endDate;
  }
}

function addEducation(educations: FoundEducation[], next: FoundEducation) {
  const degree = normalizeDegree(next.degree);
  // Sources label one degree differently ("BA ’55", "bachelor's of business
  // administration"): the same year is the same degree, and the first label stays.
  const same =
    educations.find((e) => e.gradYear !== null && e.gradYear === next.gradYear) ??
    educations.find((e) => (e.degree === degree || !e.degree || !degree) && (!e.gradYear || !next.gradYear));
  if (!same) educations.push({ ...next, degree });
  else {
    same.degree ??= degree;
    same.major ??= next.major;
    if (!same.gradYear && next.gradYear) Object.assign(same, { gradYear: next.gradYear, sourceUrl: next.sourceUrl, quote: next.quote });
  }
}

export interface LookupDeps {
  ai: Ai;
  industries: { slug: string; name: string }[];
  /** Replaces the web search (tests). */
  search?: typeof webSearch;
}

export async function lookupPerson(input: LookupInput, { ai, industries, search = webSearch }: LookupDeps): Promise<PersonFindings> {
  const name = input.fullName.trim();
  const { last } = nameWords(name);
  const context = [input.hint, input.title, input.organizationName].filter(Boolean).join(" ").trim();
  const worthReading = (r: { title?: string; content?: string }) => {
    const text = `${r.title ?? ""} ${r.content ?? ""}`.toLowerCase();
    return text.includes(last) && /wisconsin|\buw\b|badger|\bbba\b|\bmba\b|class of|alum|graduat/.test(text);
  };

  const searches = await Promise.allSettled([
    search(`"${name}" "University of Wisconsin" ${context}`.trim(), { maxResults: 6, rawContent: worthReading, spread: "all" }),
    search(`"${name}" (BBA OR MBA OR alumni OR "class of")`, { maxResults: 5, includeDomains: UW_SITES, rawContent: worthReading, spread: "all" }),
    search(`"${name}" ${context || "University of Wisconsin-Madison"} linkedin`, { maxResults: 5, includeDomains: ["linkedin.com"], spread: "all" }),
  ]);
  const failed = searches.filter((s) => s.status === "rejected");
  if (failed.length === searches.length) throw (failed[0] as PromiseRejectedResult).reason;
  // UW–Madison's own pages first, then LinkedIn, then the rest of the web.
  const [general, uw, profiles] = searches.map((s) => (s.status === "fulfilled" ? s.value : []));
  const selected = selectSources(input, [...uw, ...profiles, ...general]);

  const findings: PersonFindings = {
    linkedinUrl: selected.linkedin?.result.url.split(/[?#]/)[0] ?? null,
    alumniStatus: "unknown",
    alumniSourceUrl: null,
    educations: [],
    positions: [],
    location: null,
    industrySlug: null,
    specialties: [],
    sources: selected.kept.map((k) => ({ url: k.result.url, title: k.result.title ?? "" })),
    notes: [...selected.notes],
    model: null,
  };
  if (!selected.kept.length) {
    findings.notes.push("No public page ties this name to UW–Madison. Add an employer, city or class year and search again.");
    return findings;
  }
  const sources: EnrichmentSource[] = selected.kept.map((k, i) => ({ id: `S${i + 1}`, url: k.result.url, text: k.text }));

  // --- The model: degrees, alumni status, location, industry; and jobs. ---
  const [enrichment, career] = await Promise.allSettled([
    twice(() => ai.extractEnrichment({ fullName: name, title: input.title ?? null, organizationName: input.organizationName ?? null, sources, industries })),
    twice(() => ai.extractCareer({ fullName: name, sources })),
  ]);
  if (enrichment.status === "fulfilled") {
    const verified = verifyEnrichment(enrichment.value, sources, new Set(industries.map((i) => i.slug)));
    findings.model = enrichment.value.model;
    findings.alumniStatus = verified.alumniStatus;
    findings.alumniSourceUrl = verified.alumniEvidence?.sourceUrl ?? null;
    for (const e of verified.uwEducations) {
      if (e.degree || e.major || e.gradYear) addEducation(findings.educations, { degree: e.degree, major: e.major, gradYear: e.gradYear, sourceUrl: e.sourceUrl, quote: e.evidence });
    }
    findings.location = verified.location;
    findings.industrySlug = verified.industrySlug;
    findings.specialties = verified.specialties;
    if (verified.rejected.length) findings.notes.push(`Dropped (no matching quote in the source): ${verified.rejected.join("; ")}`);
  } else {
    findings.notes.push(`The model couldn't read the sources (${String((enrichment.reason as Error).message).slice(0, 120)}); only pattern matches were used.`);
  }
  if (career.status === "fulfilled") {
    for (const p of career.value.positions) {
      const source = findSource(p.evidence, p.sourceId, sources);
      if (!source) continue;
      const from = selected.kept.find((k) => k.result.url === source.url);
      const isCurrent = p.isCurrent && !p.endYear && (from?.kind === "linkedin" || isRecent(from?.result.published));
      addPosition(findings.positions, { title: p.title.trim(), organization: p.organization.trim(), startDate: yearDate(p.startYear), endDate: yearDate(p.endYear), isCurrent, sourceUrl: source.url });
    }
  } else {
    findings.notes.push("The model couldn't read work history from the sources. Search again in a minute.");
  }

  // --- Plain patterns: they work without a model and double-check it. ---
  const classYears: (ClassYearFinding & { sourceUrl: string })[] = [];
  for (const k of selected.kept) {
    const pageIsAboutThem = k.kind === "linkedin" || (k.result.title ?? "").toLowerCase().includes(last);
    for (const f of findClassYears(k.text, { uwContext: k.kind === "uw", about: { fullName: name, pageIsAboutThem } })) classYears.push({ ...f, sourceUrl: k.result.url });
  }
  for (const f of chooseClassYears(classYears)) {
    const sourceUrl = classYears.find((c) => c.year === f.year && c.degree === f.degree)!.sourceUrl;
    addEducation(findings.educations, { degree: f.degree, major: null, gradYear: f.year, sourceUrl, quote: f.quote });
  }
  if (selected.linkedin) {
    const url = selected.linkedin.result.url;
    const parsed = parseLinkedInSnippet(selected.linkedin.text);
    for (const p of parsed.experience) addPosition(findings.positions, { ...p, sourceUrl: url });
    for (const e of parsed.education.filter((x) => isUwMadison(x.school))) {
      const { degree, major } = degreeFromDetails(e.details);
      addEducation(findings.educations, { degree, major, gradYear: null, sourceUrl: url, quote: [e.school, e.details].filter(Boolean).join(", ") });
    }
    if (!findings.location && parsed.location) findings.location = { city: parsed.location.city, state: parsed.location.state, sourceUrl: url };
  }
  if (findings.location && findings.location.state && findings.location.state.length > 2) {
    findings.location.state = US_STATES[findings.location.state.toLowerCase()] ?? null;
  }
  // A stated UW–Madison degree or class year is a source saying they're an alum.
  if (findings.educations.length && findings.alumniStatus !== "source_stated") {
    findings.alumniStatus = "source_stated";
    findings.alumniSourceUrl = findings.educations[0].sourceUrl;
  }
  // Newest first; the current main job leads.
  findings.positions.sort(
    (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.startDate ?? "").localeCompare(a.startDate ?? "") || Number(SIDE_ROLE.test(a.title)) - Number(SIDE_ROLE.test(b.title)),
  );
  return findings;
}
