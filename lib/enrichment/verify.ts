// The "no source, no field" rule, enforced in code: a fact the model extracted
// is kept only if its evidence quote really appears in the cited source.
import type { Enrichment, EnrichmentSource } from "@/lib/ai/schemas";

export type AlumniStatus = "source_stated" | "likely" | "not_alumnus" | "unknown";

export interface VerifiedEducation {
  degree: string | null;
  major: string | null;
  gradYear: number | null;
  evidence: string;
  sourceUrl: string;
}

export interface VerifiedEnrichment {
  alumniStatus: AlumniStatus;
  alumniEvidence: { quote: string; sourceUrl: string } | null;
  uwEducations: VerifiedEducation[];
  location: { city: string; state: string | null; sourceUrl: string } | null;
  industrySlug: string | null;
  specialties: string[];
  /** Claims dropped because their quote wasn't found in the source. */
  rejected: string[];
}

const OTHER_UW_CAMPUS =
  /\b(uw|university (?:of )?wisconsin)[\s\-–—,]*(milwaukee|eau claire|whitewater|oshkosh|la crosse|stout|platteville|stevens point|green bay|parkside|river falls|superior)\b/i;
const MADISON_EXPLICIT = /madison|wisconsin school of business|\bwsb\b/i;
// A status quote must actually say the person studied there, not just that they work(ed) with the school.
const ALUMNI_WORDS = /\b(alum(nus|na|ni)?|graduate[sd]?|graduated|graduating|degree|earned|holds?|received|studied|attended|class of|bachelor'?s?|master'?s?|bba|mba|b\.?s\.?|b\.?a\.?|m\.?s\.?|j\.?d\.?|ph\.?d)\b/i;
const HONORARY = /\bhonorary\b/i;

const UW_MENTION = /\b(uw|university (?:of )?wisconsin)\b[\s\-–—,]*(milwaukee|eau claire|whitewater|oshkosh|la crosse|stout|platteville|stevens point|green bay|parkside|river falls|superior)?/gi;

/**
 * True when the degree in this quote is from a UW campus other than Madison.
 * Handles quotes that mention two campuses ("an M.S. from the University of
 * Wisconsin and a BBA from UW–Milwaukee") by looking at the first UW mention
 * after the degree itself.
 */
export function degreeIsFromOtherCampus(evidence: string, degree: string | null): boolean {
  if (MADISON_EXPLICIT.test(evidence)) return false;
  const mentions = [...evidence.matchAll(UW_MENTION)].map((m) => ({ index: m.index ?? 0, otherCampus: Boolean(m[2]) }));
  if (!mentions.some((m) => m.otherCampus)) return false;
  if (mentions.every((m) => m.otherCampus)) return true;
  const degreeAt = degree ? evidence.toLowerCase().indexOf(degree.toLowerCase().replace(/\s+degree$/, "")) : -1;
  if (degreeAt < 0) return true; // can't tell which campus: don't claim Madison
  const next = mentions.find((m) => m.index > degreeAt) ?? mentions[mentions.length - 1];
  return next.otherCampus;
}

/** Lowercase, collapse whitespace, unify quotes and dashes, so cosmetic differences don't fail a real quote. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function findSource(quote: string | null, sourceId: string | null, sources: EnrichmentSource[]): EnrichmentSource | null {
  if (!quote || normalizeForMatch(quote).length < 4) return null;
  const needle = normalizeForMatch(quote);
  const preferred = sources.find((s) => s.id === sourceId);
  for (const source of preferred ? [preferred, ...sources.filter((s) => s !== preferred)] : sources) {
    if (normalizeForMatch(source.text).includes(needle)) return source;
  }
  return null;
}

const DEGREE_ALIASES: [RegExp, string][] = [
  [/^bachelor of business administration$/i, "BBA"],
  [/^master of business administration$/i, "MBA"],
  [/^bachelor of science$/i, "BS"],
  [/^bachelor of arts$/i, "BA"],
  [/^master of science$/i, "MS"],
  [/^master of arts$/i, "MA"],
  [/^juris doctor(ate)?$/i, "JD"],
  [/^b\.?b\.?a\.?$/i, "BBA"],
  [/^m\.?b\.?a\.?$/i, "MBA"],
  [/^b\.?s\.?$/i, "BS"],
  [/^b\.?a\.?$/i, "BA"],
  [/^m\.?s\.?$/i, "MS"],
  [/^m\.?a\.?$/i, "MA"],
  [/^j\.?d\.?$/i, "JD"],
  [/^ph\.?d\.?$/i, "PhD"],
];

export function normalizeDegree(degree: string | null): string | null {
  if (!degree) return null;
  const trimmed = degree.trim().replace(/\s+degree$/i, "");
  for (const [pattern, short] of DEGREE_ALIASES) if (pattern.test(trimmed)) return short;
  return trimmed;
}

const SENIOR = new Set(["c_suite", "vp", "partner", "owner", "director"]);

export function verifyEnrichment(
  result: Enrichment,
  sources: EnrichmentSource[],
  knownIndustrySlugs: Set<string>,
  context: { seniority?: string | null; now?: Date } = {},
): VerifiedEnrichment {
  const rejected: string[] = [];
  // A web page about someone else with the same name shows up as a recent
  // graduate attached to a senior executive. Drop those degrees.
  const currentYear = (context.now ?? new Date()).getFullYear();
  // Sources shown to be about a different person: nothing from them counts.
  const distrusted = new Set<string>();
  if (context.seniority && SENIOR.has(context.seniority)) {
    const implausible = result.educations.filter((e) => e.gradYear && e.gradYear > currentYear - 5);
    if (implausible.length) {
      rejected.push(`education (class of ${implausible.map((e) => e.gradYear).join(", ")} doesn't fit a ${context.seniority.replace("_", "-")} role; likely another person)`);
      result = { ...result, educations: result.educations.filter((e) => !implausible.includes(e)) };
      for (const e of implausible) distrusted.add(e.sourceId);
      result = { ...result, educations: result.educations.filter((e) => !distrusted.has(e.sourceId)) };
    }
  }

  const uwEducations: VerifiedEducation[] = [];
  let sawOtherDegrees = false;
  let uwQuoteMentionsMadison = false;
  for (const edu of result.educations) {
    const source = findSource(edu.evidence, edu.sourceId, sources);
    if (!source) {
      rejected.push(`education "${edu.degree ?? ""} ${edu.institution}" (quote not found)`);
      continue;
    }
    if (HONORARY.test(`${edu.degree ?? ""} ${edu.evidence}`)) {
      rejected.push(`education "${edu.degree ?? ""}" (honorary)`);
      continue;
    }
    const isOtherCampus = degreeIsFromOtherCampus(edu.evidence, edu.degree);
    if (edu.isUwMadison && !isOtherCampus) {
      const degree = normalizeDegree(edu.degree);
      const duplicate = uwEducations.find((e) => e.degree === degree && (e.gradYear === edu.gradYear || !e.gradYear || !edu.gradYear));
      if (duplicate) {
        duplicate.gradYear ??= edu.gradYear;
        duplicate.major ??= edu.major?.trim() || null;
        continue;
      }
      uwEducations.push({
        degree,
        major: edu.major?.trim() || null,
        gradYear: edu.gradYear,
        evidence: edu.evidence,
        sourceUrl: source.url,
      });
      if (MADISON_EXPLICIT.test(edu.evidence)) uwQuoteMentionsMadison = true;
    } else {
      sawOtherDegrees = true;
    }
  }

  // Alumni status is decided from verified evidence, not taken from the model.
  let alumniStatus: AlumniStatus = "unknown";
  let alumniEvidence: VerifiedEnrichment["alumniEvidence"] = null;
  const trusted = sources.filter((s) => !distrusted.has(s.id));
  const statusSource = findSource(result.uwMadisonEvidence, null, trusted);
  if (uwEducations.length) {
    alumniStatus = uwQuoteMentionsMadison ? "source_stated" : "likely";
    alumniEvidence = { quote: uwEducations[0].evidence, sourceUrl: uwEducations[0].sourceUrl };
  } else if (statusSource && (result.uwMadisonStatus === "source_stated" || result.uwMadisonStatus === "likely")) {
    const quote = result.uwMadisonEvidence!;
    if (OTHER_UW_CAMPUS.test(quote) && !MADISON_EXPLICIT.test(quote)) {
      rejected.push("alumni status (quote names another UW campus)");
    } else if (!ALUMNI_WORDS.test(quote) || HONORARY.test(quote)) {
      rejected.push("alumni status (quote doesn't say they studied there)");
    } else {
      alumniStatus = MADISON_EXPLICIT.test(quote) ? "source_stated" : "likely";
      alumniEvidence = { quote, sourceUrl: statusSource.url };
    }
  } else if (result.uwMadisonStatus === "not_alumnus" && sawOtherDegrees) {
    alumniStatus = "not_alumnus";
  } else if (result.uwMadisonStatus !== "unknown" && !statusSource) {
    rejected.push(`alumni status "${result.uwMadisonStatus}" (quote not found)`);
  }

  let location: VerifiedEnrichment["location"] = null;
  if (result.location.city) {
    const source = findSource(result.location.evidence, result.location.sourceId, sources);
    if (source) {
      const state = result.location.state && /^[A-Z]{2}$/.test(result.location.state) ? result.location.state : null;
      location = { city: result.location.city.trim(), state, sourceUrl: source.url };
    } else {
      rejected.push(`location "${result.location.city}" (quote not found)`);
    }
  }

  const industrySlug = result.industrySlug && knownIndustrySlugs.has(result.industrySlug) ? result.industrySlug : null;
  if (result.industrySlug && !industrySlug) rejected.push(`industry "${result.industrySlug}" (not in taxonomy)`);

  // Specialties are short labels, so they must appear in the sources nearly verbatim.
  const allText = normalizeForMatch(sources.map((s) => s.text).join(" "));
  const specialties = result.specialties
    .map((s) => s.trim())
    .filter((s) => s && allText.includes(normalizeForMatch(s)));

  return { alumniStatus, alumniEvidence, uwEducations, location, industrySlug, specialties, rejected };
}
