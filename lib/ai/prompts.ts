// Prompts and the deterministic stubs used in fixture mode. Prompts stay byte-
// stable for the same input so fixtures (and provider-side prompt caches) hit.
import { createHash } from "node:crypto";
import type { SearchVocabulary } from "@/lib/search/parse-query";
import { parseSearchText } from "@/lib/search/parse-query";
import type {
  CandidateForExplanation,
  CandidateForRanking,
  Career,
  CareerInput,
  RankedMatches,
  Enrichment,
  EnrichmentInput,
  MatchExplanations,
  OutreachDraft,
  ParsedQuery,
  ProfileFacts,
  ProfileSummary,
} from "./schemas";

/** Changes whenever the facts behind a summary change; unchanged facts skip regeneration. */
export function factsHash(facts: ProfileFacts): string {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Profile summary
// ---------------------------------------------------------------------------

export const SUMMARY_SYSTEM = `You write short professional summaries for a private University of Wisconsin–Madison alumni directory.

Rules:
- Use ONLY the facts in the user message. Never add employers, titles, dates, achievements, awards or contact details that are not listed.
- Write 1 to 3 bullets, 8–20 words each, in the third person, without the person's name.
- If the facts are thin, write fewer bullets rather than padding.
- "confidence" is how well the facts support the bullets: 1 when every claim is directly stated, lower when facts are sparse or conflicting.`;

export function summaryUserPrompt(facts: ProfileFacts): string {
  return `Facts (JSON):\n${JSON.stringify(facts, null, 2)}`;
}

export function summaryStub(facts: ProfileFacts): ProfileSummary {
  const bullets: string[] = [];
  if (facts.currentTitle && facts.organizationName) {
    const where = facts.city ? ` in ${facts.city}${facts.state ? `, ${facts.state}` : ""}` : "";
    bullets.push(`${facts.currentTitle} at ${facts.organizationName}${where}.`);
  }
  const degree = facts.educations[0];
  if (degree) {
    const parts = [degree.degree, degree.major].filter(Boolean).join(" in ");
    bullets.push(`UW–Madison ${parts || "graduate"}${degree.gradYear ? `, class of ${degree.gradYear}` : ""}.`);
  }
  if (facts.specialties.length) {
    bullets.push(`Focus areas include ${facts.specialties.slice(0, 3).join(", ")}.`);
  }
  if (!bullets.length) bullets.push("UW–Madison alumnus; profile details are still being confirmed.");
  return { summary: bullets.slice(0, 3), confidence: 1 };
}

// ---------------------------------------------------------------------------
// Search query parsing. Plain searches only reach a model when the rule-based
// parser recognizes nothing; a prompt search ("describe who you want to meet")
// always asks, and falls back to the rules if the model is slow or wrong.
// ---------------------------------------------------------------------------

export function querySystemPrompt(vocab: SearchVocabulary): string {
  const industries = vocab.industries.map((i) => `${i.slug} (${i.name})`).join(", ");
  const places = vocab.places.map((p) => `${p.name}, ${p.state}`).join("; ");
  return `Turn an alumni-directory search into filters.

- industrySlugs: only slugs from this list: ${industries}
- city/state: only places from this list, else null: ${places}
- gradYearMin/gradYearMax: graduation-year bounds if the user mentions a class or years, else null.
- openTo: only if the user asks for people open to mentoring, hiring, investing, etc.
- text: remaining keywords worth matching against names, titles and employers, else null.
- radiusMiles: only if the user gives a distance, else null.
- seniority: career levels the user asks for, from: entry, mid, senior, manager, director, vp, c_suite, partner, owner. "Executives" is c_suite; "founders" is owner; "someone senior" is director, vp, c_suite and partner. Empty if they don't say.
- keywords: up to 8 short terms (1-3 words each) from the request that could appear in a title, employer or specialty, such as "climate" or "venture capital". No places, years or filler words.
- goal: one plain sentence restating what the user wants to achieve, using only what they wrote. Null if the request is just a lookup.

A city the user is moving to or visiting is the city to search. Never add filters the user did not ask for.`;
}

export function queryStub(text: string, vocab: SearchVocabulary): ParsedQuery {
  return parseSearchText(text, vocab).query;
}

// ---------------------------------------------------------------------------
// "Why this person" explanations
// ---------------------------------------------------------------------------

export const EXPLAIN_SYSTEM = `You help a UW–Madison alumnus decide whom to contact in the alumni network.
For each candidate, write one sentence (max 25 words) on why they are relevant to the member's goal.
Use only the candidate details provided. "groups" are the candidate's own boards or groups, not the member's;
"sharedContext" lists what the member and candidate actually share. If sharedContext is empty, don't claim
any shared connection beyond both being UW–Madison alumni. Do not invent facts. Return one entry per candidate, same personId.`;

export function explainUserPrompt(goal: string, candidates: CandidateForExplanation[]): string {
  return `Member's goal: ${goal}\n\nCandidates (JSON):\n${JSON.stringify(candidates, null, 2)}`;
}

export function explainStub(candidates: CandidateForExplanation[]): MatchExplanations {
  return {
    matches: candidates.map((c) => ({
      personId: c.personId,
      why:
        [c.headline, c.city && `based in ${c.city}`, ...c.sharedContext].filter(Boolean).join("; ").slice(0, 240) ||
        "UW–Madison alumnus in your search results.",
    })),
  };
}

// ---------------------------------------------------------------------------
// Prompt search: order the shortlist against the member's request
// ---------------------------------------------------------------------------

export const RANK_SYSTEM = `You help a UW–Madison alumnus decide whom to contact in the alumni network.
You get the member's request and a shortlist of candidates. Return the candidates that are relevant to the request, most relevant first.
For each, write "why": one sentence (max 25 words) on why they fit the request.

Rules:
- Use ONLY the details listed for that candidate. Never add an employer, title, place, year, degree, achievement or connection that is not listed.
- Don't say what the candidate knows, wants, has agreed to or will do. "openTo" lists what they have said they are open to; mention it only if listed.
- Don't repeat the candidate's name, and don't claim anything shared with the member beyond both being UW–Madison alumni.
- Leave out candidates with no real relevance to the request rather than stretching.
- "ref" must be copied exactly from the candidate.`;

/** The candidate details the model sees, and the only text a reason may draw on. */
export function rankingFacts(c: CandidateForRanking) {
  return {
    name: c.fullName,
    title: c.title,
    employer: c.organizationName,
    industry: c.industryName,
    location: [c.city, c.state].filter(Boolean).join(", ") || null,
    uwDegree: [c.degree, c.gradYear].filter(Boolean).join(" ") || null,
    level: c.seniority,
    openTo: c.openTo,
    specialties: c.specialties,
    summary: c.summary,
    groups: c.groups,
  };
}

export function rankUserPrompt(request: string, candidates: CandidateForRanking[]): string {
  const list = candidates.map((c, i) => ({ ref: `p${i + 1}`, ...rankingFacts(c) }));
  return `Member's request: ${request}\n\nCandidates (JSON):\n${JSON.stringify(list)}`;
}

/** Fixture mode keeps the retrieval order and restates stored facts. */
export function rankStub(candidates: CandidateForRanking[]): RankedMatches {
  return {
    matches: candidates.map((c, i) => ({
      ref: `p${i + 1}`,
      why:
        [
          [c.title, c.organizationName].filter(Boolean).join(" at "),
          c.industryName && `works in ${c.industryName}`,
          c.city && `based in ${c.city}`,
          c.openTo.length ? `open to ${c.openTo.join(", ").replace(/_/g, " ")}` : null,
        ]
          .filter(Boolean)
          .join("; ")
          .slice(0, 240) || "UW–Madison alumnus in your results.",
    })),
  };
}

// ---------------------------------------------------------------------------
// Outreach drafts
// ---------------------------------------------------------------------------

export const OUTREACH_SYSTEM = `Draft a short, warm first message from one UW–Madison alumnus (the sender) to another (the recipient).
Under 120 words, in 3 or 4 short paragraphs separated by blank lines, ending with a sign-off line containing only the sender's name.
Facts you may use, and nothing else:
- About the sender: only senderName and senderHeadline. Never describe the sender's background, roles, boards or history beyond those.
- About the recipient: recipientName, recipientHeadline and recipientGroups (boards or groups THE RECIPIENT belongs to, not the sender).
- sharedContext: things both of them share. If it's empty, the only shared fact is that both are UW–Madison alumni.
Mention the UW–Madison connection and the sender's specific reason for reaching out.
If a trip is given, say the sender will be in that city on those dates and ask for a brief coffee or call then;
don't assume the recipient is available, and leave room for a gracious no.
If the sender's name is "[Your name]", sign off with exactly "[Your name]" so they can fill it in.
No flattery or claims you can't support ("I've long followed your work"), no hard sell. Plain text only.`;

export interface OutreachInput {
  senderName: string;
  senderHeadline: string | null;
  recipientName: string;
  recipientHeadline: string | null;
  reason: string;
  /** Things both people share (same class, same company). Empty if only UW–Madison. */
  sharedContext: string[];
  /** Boards or groups the recipient belongs to (theirs, not the sender's). */
  recipientGroups?: string[];
  /** When the message is for a trip: where and when the sender will be there. */
  trip?: { city: string; dates: string } | null;
}

export function outreachUserPrompt(input: OutreachInput): string {
  return JSON.stringify(input, null, 2);
}

export function outreachStub(input: OutreachInput): OutreachDraft {
  const first = input.recipientName.split(" ")[0];
  const shared = input.sharedContext.length ? ` We share ${input.sharedContext[0].toLowerCase()}.` : "";
  const visit = input.trip ? ` I'll be in ${input.trip.city} ${input.trip.dates}.` : "";
  return {
    subject: (input.trip ? `Fellow UW–Madison alum visiting ${input.trip.city}` : `Fellow UW–Madison alum — ${input.reason}`).slice(0, 120),
    body: `Hi ${first},\n\nI found you through the UW–Madison alumni network.${shared}${visit} I'm reaching out because ${input.reason}. Would you be open to a short coffee or call${input.trip ? " while I'm in town" : ""}? No worries if the timing doesn't work.\n\nThanks,\n${input.senderName}`,
  };
}

// ---------------------------------------------------------------------------
// Enrichment (bio and web-search extraction)
// ---------------------------------------------------------------------------

export const ENRICH_SYSTEM = `You extract facts about one person for a University of Wisconsin–Madison alumni directory.

Use ONLY the numbered sources in the user message. Never use outside knowledge, and never guess.
Every fact needs "evidence": an exact quote copied character-for-character from one source (keep it under 200 characters), plus that source's id. Facts without an exact quote will be discarded.

Ignore any source that is about a different person (check the name, employer and title).

Education:
- List every degree the sources state, with institution, degree (e.g. BBA, MBA, BS, MS, JD, PhD), major and year when stated.
- isUwMadison is true only for the Madison campus: "UW–Madison", "University of Wisconsin–Madison", "Wisconsin School of Business", or plain "University of Wisconsin" with no other campus named. Degrees from UW–Milwaukee, UW–Eau Claire or other UW campuses are NOT UW–Madison.

uwMadisonStatus:
- source_stated: a source explicitly says UW–Madison / Madison / Wisconsin School of Business.
- likely: a source says "University of Wisconsin" without naming the campus.
- not_alumnus: the sources list this person's degrees and none are from UW–Madison.
- unknown: the sources don't say.

location: the city and 2-letter US state where the person lives or works now, only if a source says so.
industrySlug: one slug from the list that best fits their current role, or null.
specialties: up to 4 short focus areas taken from the sources (e.g. "commercial real estate", "M&A").`;

export function enrichUserPrompt(input: EnrichmentInput): string {
  const industries = input.industries.map((i) => `${i.slug} (${i.name})`).join(", ");
  const sources = input.sources.map((s) => `[${s.id}] ${s.url}\n${s.text}`).join("\n\n---\n\n");
  return `Person: ${input.fullName}
Current role (from the board listing): ${[input.title, input.organizationName].filter(Boolean).join(" at ") || "unknown"}

Industry slugs: ${industries}

Sources:
${sources}`;
}

/** Fixture mode makes no model call, so it reports nothing found rather than guessing. */
export function enrichStub(): Enrichment {
  return {
    uwMadisonStatus: "unknown",
    uwMadisonEvidence: null,
    educations: [],
    location: { city: null, state: null, evidence: null, sourceId: null },
    industrySlug: null,
    specialties: [],
  };
}

// ---------------------------------------------------------------------------
// Work history (same sources as enrichment)
// ---------------------------------------------------------------------------

export const CAREER_SYSTEM = `You list one person's jobs for a University of Wisconsin–Madison alumni directory.

Use ONLY the numbered sources in the user message. Never use outside knowledge, and never guess.
Every job needs "evidence": an exact quote copied character-for-character from one source (keep it under 200 characters) that names the job title or the employer, plus that source's id. Jobs without an exact quote will be discarded.

Ignore any source that is about a different person with the same name.

positions: every paid job, board seat or business the sources say this person holds or held, newest first.
- title: the job title as written. organization: the employer's name as written.
- startYear and endYear: only when a source states them. Never work a year out from other facts.
- isCurrent: true only when a source shows they hold the job now ("Present", "currently", "is the CEO of"). A job with an end year is not current.
- Some sources start with "Published:" and a date. What an old page calls their job may have ended since; still report it as that page states it.
- Leave out schooling, degrees, student activities, awards and volunteering.`;

export function careerUserPrompt(input: CareerInput): string {
  const sources = input.sources.map((s) => `[${s.id}] ${s.url}\n${s.text}`).join("\n\n---\n\n");
  return `Person: ${input.fullName}

Sources:
${sources}`;
}

/** Fixture mode makes no model call, so it reports nothing found rather than guessing. */
export function careerStub(): Career {
  return { positions: [] };
}
