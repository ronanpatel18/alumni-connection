// Shared types for the contact-enrichment pipeline (npm run contacts).
// Rules it enforces are in docs/ARCHITECTURE.md §3, §3b and §7.

export type ContactKind = "email" | "phone";
export type ContactLabel = "work" | "personal" | "other";
/** contact_points.source / contact_findings.source values the pipeline can write. */
export type FindingSource = "web" | "registry" | "linkedin" | "people_search" | "hunter" | "pdl" | "apollo" | "clay";

export interface PersonRef {
  id: string;
  institutionId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  organizationName: string | null;
  /** The employer's web domain ("example.com"), when known. */
  orgDomain: string | null;
  industrySlug: string | null;
  city: string | null;
  state: string | null;
  /** Contact details already on the profile. */
  existing: { kind: string; value: string; source: string }[];
}

export type VerificationStatus = "valid" | "domain_ok" | "risky" | "invalid" | "unknown";

export interface Verification {
  status: VerificationStatus;
  /** hunter | zerobounce | neverbounce | millionverifier | mx | twilio | format */
  method: string;
  checked_at: string;
  detail?: string;
}

export interface RawFinding {
  kind: ContactKind;
  /** Normalized: lowercase email, or E.164 phone (+16085550123). */
  value: string;
  label: ContactLabel;
  source: FindingSource;
  /** Narrower origin, for per-source deletion: a host ("wisbar.org") or a registry ("npi"). */
  sourceDetail: string;
  sourceUrl: string;
  /** Exact text from the source that contains the value. */
  quote: string;
  confidence: number;
  /** Built from a company's address pattern rather than read anywhere. */
  patternGuessed: boolean;
  /**
   * The text the quote was taken from, checked before anything is kept. Null
   * for a licensed provider's API response, which is its own record.
   */
  pageText: string | null;
  /** A verdict the provider returned along with the value, if any. */
  verification?: Verification;
}

export type ReviewReason = "low_confidence" | "conflict" | "personal" | "third_party_phone" | "pattern" | "unverified";

export interface Finding extends Omit<RawFinding, "pageText"> {
  verification: Verification;
  reviewReasons: ReviewReason[];
  /** stored: saved privately straight away. pending: an administrator decides first. */
  status: "stored" | "pending";
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

/** Network access handed to sources, so tests can run them offline. */
export interface SourceContext {
  search(query: string, options: { maxResults: number; includeDomains?: string[] }): Promise<SearchHit[]>;
  /** A page as plain text, or null when it can't be read (blocked, not HTML, missing). */
  fetchPage(url: string): Promise<string | null>;
  fetchJson(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
  env: Record<string, string | undefined>;
  /** Something worth printing in the report that isn't a contact detail. */
  note(message: string): void;
}

export interface ContactSource {
  id: string;
  label: string;
  /** free: public pages and open APIs. keyed: a licensed API's free tier. paid: needs a paid plan (stub). */
  tier: "free" | "keyed" | "paid";
  /** Whether it can run with this environment, and if not, why. */
  status(env: Record<string, string | undefined>): { enabled: boolean; reason?: string };
  find(person: PersonRef, ctx: SourceContext): Promise<RawFinding[]>;
}
