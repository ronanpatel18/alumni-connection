// Reads emails and phone numbers out of page text with patterns, never a
// model, and decides whether one belongs to the person we're looking for.
// Nothing is inferred: a value exists only if it is written on the page, and
// verifyQuote() re-checks that before anything is kept (the same rule
// lib/enrichment/verify.ts applies to profile facts).
import { normalizeForMatch } from "@/lib/enrichment/verify";
import type { ContactKind, ContactLabel, PersonRef, RawFinding } from "./types";

const EMAIL = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}/g;
// North American numbers: (608) 555-0123, 608-555-0123, 608.555.0123, +1 608 555 0123.
const PHONE = /(?<![\d$#.-])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-](\d{4})(?![\d-])/g;

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "msn.com", "live.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "charter.net", "protonmail.com", "proton.me"]);
// Shared inboxes aren't a person's contact detail.
const ROLE_LOCAL = /^(info|contact|hello|hi|admin|support|help|sales|office|hr|jobs|careers|press|media|marketing|webmaster|noreply|no-reply|donotreply|team|inquiries|enquiries|general|billing|privacy|legal|abuse|news|newsletter|events|service|customerservice|feedback|mail|email)$/;
const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888", "900"]);
const NOT_AN_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

export const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
export const isFreeMail = (email: string) => FREE_MAIL.has(emailDomain(email));
export const isRoleAddress = (email: string) => ROLE_LOCAL.test(email.slice(0, email.lastIndexOf("@")).toLowerCase());

/** "+16085550123" for a well-formed North American number, else null. */
export function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  const area = digits.slice(0, 3);
  // Toll-free lines are switchboards; 555-01xx is reserved for fiction.
  if (TOLL_FREE.has(area) || /^\d{3}55501\d{2}$/.test(digits)) return null;
  if (/^(\d)\1{9}$/.test(digits)) return null;
  return `+1${digits}`;
}

export const formatUsPhone = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

export interface Candidate {
  kind: ContactKind;
  value: string;
  /** The value exactly as written on the page. */
  raw: string;
  index: number;
  /** The page's own text around the value. */
  quote: string;
}

function quoteAround(text: string, index: number, length: number) {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + length + 60);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Every email and phone number written in the text. */
export function extractCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const match of text.matchAll(EMAIL)) {
    const raw = match[0].replace(/[.,;:]+$/, "");
    if (NOT_AN_EMAIL.test(raw) || raw.length > 120) continue;
    // "j***oh@gmail.com": the tail of a masked address isn't an address.
    if (/[*\u2022\u2026\u00b7]/.test(text.slice(Math.max(0, match.index - 2), match.index))) continue;
    out.push({ kind: "email", value: raw.toLowerCase(), raw, index: match.index, quote: quoteAround(text, match.index, raw.length) });
  }
  for (const match of text.matchAll(PHONE)) {
    const value = normalizeUsPhone(match[0]);
    if (!value) continue;
    out.push({ kind: "phone", value, raw: match[0], index: match.index, quote: quoteAround(text, match.index, match[0].length) });
  }
  return out;
}

const letters = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/** Does the address's local part look like this person's name (jdoe, jane.doe, doe.jane, janed)? */
export function localPartMatchesName(email: string, person: Pick<PersonRef, "firstName" | "lastName">): boolean {
  const local = letters(email.slice(0, email.lastIndexOf("@")).replace(/\+.*$/, ""));
  const first = letters(person.firstName);
  const last = letters(person.lastName);
  if (!local || !first || last.length < 2) return false;
  const patterns = [`${first}${last}`, `${last}${first}`, `${first[0]}${last}`, `${first}${last[0]}`, `${last}${first[0]}`];
  if (patterns.includes(local)) return true;
  // A distinctive surname alone ("kowalczyk@firm.com"); short ones collide too easily.
  return last.length >= 5 && local === last;
}

const ORG_STOP = new Set(["the", "inc", "llc", "llp", "lp", "co", "corp", "corporation", "company", "group", "and", "of", "partners", "capital", "management", "holdings", "international", "global", "services", "associates"]);

/** Is this the employer's own domain (given, or its name appears in the domain)? */
export function domainMatchesOrg(domain: string, person: Pick<PersonRef, "organizationName" | "orgDomain">): boolean {
  const host = domain.toLowerCase().replace(/^www\./, "");
  if (person.orgDomain) {
    const org = person.orgDomain.toLowerCase().replace(/^www\./, "");
    if (host === org || host.endsWith(`.${org}`)) return true;
  }
  const words = (person.organizationName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !ORG_STOP.has(w));
  const label = host.split(".").slice(0, -1).join("");
  return words.length > 0 && label.includes(words[0]);
}

/** Positions where the person's name is written ("Jane Doe", "Jane Q. Doe", "Doe, Jane"). */
export function nameIndexes(text: string, person: Pick<PersonRef, "firstName" | "lastName">): number[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = esc(person.firstName.trim());
  const last = esc(person.lastName.trim());
  if (!first || !last) return [];
  const pattern = new RegExp(`\\b${first}\\b(?:\\s+[A-Z]\\.?)?(?:\\s+"[^"]{1,20}")?\\s+\\b${last}\\b|\\b${last}\\b,\\s*\\b${first}\\b`, "gi");
  return [...text.matchAll(pattern)].map((m) => m.index);
}

const NAME_BEFORE = 260;
const NAME_AFTER = 120;
const TIGHT = 140;

export interface Attribution {
  confidence: number;
  label: ContactLabel;
}

/**
 * How sure we are that a value on this page is this person's, from where it
 * sits and what it looks like. Null means "not theirs as far as we can tell".
 */
export function attribute(person: PersonRef, text: string, candidate: Candidate): Attribution | null {
  const names = nameIndexes(text, person);
  if (!names.length) return null; // a page that never names them proves nothing
  const near = names.some((at) => candidate.index - at <= NAME_BEFORE && at - candidate.index <= NAME_AFTER);
  const mentionsOrg = Boolean(person.organizationName) && normalizeForMatch(text).includes(normalizeForMatch(person.organizationName!).split(/[ ,]/)[0]);
  // The nearest mention of their name before the value.
  const closest = names.filter((at) => at <= candidate.index).pop();

  if (candidate.kind === "email") {
    if (isRoleAddress(candidate.value)) return null;
    const localMatch = localPartMatchesName(candidate.value, person);
    const orgDomain = domainMatchesOrg(emailDomain(candidate.value), person);
    const label: ContactLabel = isFreeMail(candidate.value) ? "personal" : "work";
    if (localMatch && orgDomain) return { confidence: 0.95, label };
    if (localMatch && near) return { confidence: 0.9, label };
    if (localMatch) return { confidence: 0.75, label };
    // An address that doesn't look like their name (initials, a nickname) must
    // be the first one straight after it, or it is more likely a colleague's.
    const follows = closest !== undefined && candidate.index - closest <= TIGHT && !text.slice(closest, candidate.index).includes("@");
    if (follows && orgDomain) return { confidence: 0.6, label };
    if (follows) return { confidence: 0.4, label };
    return null;
  }

  if (!near || closest === undefined) return null;
  // A directory page lists many people: the number must follow their name closely.
  const tight = candidate.index - closest <= TIGHT;
  if (names.length <= 2 && mentionsOrg && tight) return { confidence: 0.7, label: "work" };
  if (tight) return { confidence: 0.55, label: "work" };
  return { confidence: 0.4, label: "work" };
}

/** True when the quote really is on the page and really contains the value. */
export function verifyQuote(finding: Pick<RawFinding, "kind" | "value" | "quote" | "pageText">): boolean {
  if (finding.pageText === null) return true; // a licensed API's own response
  const quote = normalizeForMatch(finding.quote);
  if (quote.length < 6 || !normalizeForMatch(finding.pageText).includes(quote)) return false;
  if (finding.kind === "email") return quote.includes(finding.value.toLowerCase());
  return extractCandidates(finding.quote).some((c) => c.kind === "phone" && c.value === finding.value);
}
