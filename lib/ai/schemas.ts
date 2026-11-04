// Output schemas for every AI task. All fields are required (nullable where
// optional) so the same schema works with strict JSON-schema decoding on
// OpenAI-compatible hosts, Ollama and Claude structured outputs.
import { z } from "zod";

export const OPEN_TO_VALUES = [
  "networking",
  "mentoring",
  "hiring",
  "job_seeking",
  "investing",
  "fundraising",
  "referrals",
  "meeting_travelers",
  "speaking",
] as const;

export const profileSummarySchema = z.strictObject({
  summary: z.array(z.string().min(1).max(220)).min(1).max(3),
  confidence: z.number().min(0).max(1),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

export const parsedQuerySchema = z.strictObject({
  text: z.string().max(200).nullable(),
  industrySlugs: z.array(z.string()).max(5),
  city: z.string().max(80).nullable(),
  state: z.string().max(2).nullable(),
  radiusMiles: z.number().int().min(1).max(500).nullable(),
  gradYearMin: z.number().int().min(1900).max(2100).nullable(),
  gradYearMax: z.number().int().min(1900).max(2100).nullable(),
  openTo: z.array(z.enum(OPEN_TO_VALUES)).max(5),
});
export type ParsedQuery = z.infer<typeof parsedQuerySchema>;

export const matchExplanationsSchema = z.strictObject({
  matches: z
    .array(
      z.strictObject({
        personId: z.string(),
        why: z.string().min(1).max(240),
      }),
    )
    .max(30),
});
export type MatchExplanations = z.infer<typeof matchExplanationsSchema>;

export const outreachDraftSchema = z.strictObject({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(1500),
});
export type OutreachDraft = z.infer<typeof outreachDraftSchema>;

/** Facts we hand the model. It may only restate these, never add to them. */
export interface ProfileFacts {
  fullName: string;
  currentTitle: string | null;
  organizationName: string | null;
  industryName: string | null;
  city: string | null;
  state: string | null;
  specialties: string[];
  bio: string | null;
  educations: { school: string | null; degree: string | null; major: string | null; gradYear: number | null }[];
  positions: { title: string; organizationName: string; isCurrent: boolean; startYear?: number | null; endYear?: number | null }[];
}

export interface CandidateForExplanation {
  personId: string;
  fullName: string;
  headline: string | null;
  city: string | null;
  industryName: string | null;
  gradYear: number | null;
  sharedContext: string[];
}

// ---------------------------------------------------------------------------
// Enrichment: facts extracted from bios and web search results. Every fact
// carries a verbatim evidence quote, which lib/enrichment/verify.ts checks
// against the source text before anything is saved.
// ---------------------------------------------------------------------------

export const UW_STATUS_VALUES = ["source_stated", "likely", "not_alumnus", "unknown"] as const;

export const enrichmentSchema = z.strictObject({
  uwMadisonStatus: z.enum(UW_STATUS_VALUES),
  uwMadisonEvidence: z.string().max(500).nullable(),
  educations: z
    .array(
      z.strictObject({
        institution: z.string().max(200),
        isUwMadison: z.boolean(),
        degree: z.string().max(60).nullable(),
        major: z.string().max(200).nullable(),
        gradYear: z.number().int().min(1930).max(2035).nullable(),
        evidence: z.string().max(500),
        sourceId: z.string().max(10),
      }),
    )
    .max(8),
  location: z.strictObject({
    city: z.string().max(80).nullable(),
    state: z.string().max(2).nullable(),
    evidence: z.string().max(500).nullable(),
    sourceId: z.string().max(10).nullable(),
  }),
  industrySlug: z.string().max(60).nullable(),
  specialties: z.array(z.string().max(60)).max(4),
});
export type Enrichment = z.infer<typeof enrichmentSchema>;

export interface EnrichmentSource {
  id: string;
  url: string;
  text: string;
}

export interface EnrichmentInput {
  fullName: string;
  title: string | null;
  organizationName: string | null;
  sources: EnrichmentSource[];
  industries: { slug: string; name: string }[];
}
