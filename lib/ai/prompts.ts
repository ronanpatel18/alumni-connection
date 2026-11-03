// Prompts and the deterministic stubs used in fixture mode. Prompts stay byte-
// stable for the same input so fixtures (and provider-side prompt caches) hit.
import { createHash } from "node:crypto";
import type { SearchVocabulary } from "@/lib/search/parse-query";
import { parseSearchText } from "@/lib/search/parse-query";
import type {
  CandidateForExplanation,
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
// Search query parsing (only used when the rule-based parser recognizes nothing)
// ---------------------------------------------------------------------------

export function querySystemPrompt(vocab: SearchVocabulary): string {
  const industries = vocab.industries.map((i) => `${i.slug} (${i.name})`).join(", ");
  const places = vocab.places.map((p) => `${p.name}, ${p.state}`).join("; ");
  return `Turn an alumni-directory search into filters.

- industrySlugs: only slugs from this list: ${industries}
- city/state: only places from this list, else null: ${places}
- gradYearMin/gradYearMax: graduation-year bounds if the user mentions a class or years, else null.
- openTo: only if the user asks for people open to mentoring, hiring, investing, etc.
- text: remaining keywords worth matching against names, titles and employers, else null.`;
}

export function queryStub(text: string, vocab: SearchVocabulary): ParsedQuery {
  return parseSearchText(text, vocab).query;
}

// ---------------------------------------------------------------------------
// "Why this person" explanations
// ---------------------------------------------------------------------------

export const EXPLAIN_SYSTEM = `You help a UW–Madison alumnus decide whom to contact in the alumni network.
For each candidate, write one sentence (max 25 words) on why they are relevant to the member's goal.
Use only the candidate details provided. Do not invent facts. Return one entry per candidate, same personId.`;

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
// Outreach drafts
// ---------------------------------------------------------------------------

export const OUTREACH_SYSTEM = `Draft a short, warm first message from one UW–Madison alumnus to another.
Under 120 words. Mention the shared UW–Madison connection and the sender's specific reason for reaching out.
Do not invent facts about either person. No flattery, no hard sell. Plain text only.`;

export interface OutreachInput {
  senderName: string;
  senderHeadline: string | null;
  recipientName: string;
  recipientHeadline: string | null;
  reason: string;
  sharedContext: string[];
}

export function outreachUserPrompt(input: OutreachInput): string {
  return JSON.stringify(input, null, 2);
}

export function outreachStub(input: OutreachInput): OutreachDraft {
  const first = input.recipientName.split(" ")[0];
  const shared = input.sharedContext.length ? ` We share ${input.sharedContext[0].toLowerCase()}.` : "";
  return {
    subject: `Fellow UW–Madison alum — ${input.reason}`.slice(0, 120),
    body: `Hi ${first},\n\nI found you through the UW–Madison alumni network.${shared} I'm reaching out because ${input.reason}. Would you be open to a short call or coffee?\n\nThanks,\n${input.senderName}`,
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
