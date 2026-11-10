// The contact-enrichment pipeline for one person: suppression first, then the
// source waterfall, then proof (the quote is really on the page), validity
// checks, and the decision between "store privately" and "an administrator
// decides". No model is involved anywhere, so nothing can be made up.
import { createHash } from "node:crypto";
import { verifyQuote } from "./extract";
import { verifyEmail, verifyPhone } from "./validate";
import type { ContactSource, Finding, PersonRef, RawFinding, ReviewReason, SourceContext, Verification } from "./types";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** People who asked to be removed. Checked before any source is asked anything. */
export interface Suppression {
  names: Set<string>;
  emailHashes: Set<string>;
}

export function buildSuppression(rows: { full_name: string; email_sha256: string | null }[]): Suppression {
  return {
    names: new Set(rows.map((r) => r.full_name.trim().toLowerCase())),
    emailHashes: new Set(rows.flatMap((r) => (r.email_sha256 ? [r.email_sha256] : []))),
  };
}

/** A name on the list is skipped outright; a namesake losing out is the safe direction to err. */
export const isSuppressedPerson = (person: Pick<PersonRef, "fullName">, s: Suppression) => s.names.has(person.fullName.trim().toLowerCase());
/** Same hash the removal functions store: SHA-256 of the lowercased address. */
export const isSuppressedEmail = (email: string, s: Suppression) => s.emailHashes.has(sha256(email.toLowerCase()));

export interface Dropped {
  kind: string;
  value: string;
  source: string;
  why: string;
}

export interface PersonReport {
  person: PersonRef;
  skipped: string | null;
  findings: Finding[];
  dropped: Dropped[];
  notes: string[];
  sourcesTried: string[];
}

const AUTO_STORE_CONFIDENCE = 0.8;

/** Why an administrator should look before this value is used. Empty means it can be stored privately now. */
export function reviewReasons(f: RawFinding & { verification: Verification }, conflicting: boolean): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (conflicting) reasons.push("conflict");
  if (f.confidence < AUTO_STORE_CONFIDENCE) reasons.push("low_confidence");
  if (f.label !== "work") reasons.push("personal");
  if (f.kind === "phone" && f.source !== "registry") reasons.push("third_party_phone");
  if (f.patternGuessed) reasons.push("pattern");
  if (f.kind === "email" && f.verification.status !== "valid" && f.verification.status !== "domain_ok") reasons.push("unverified");
  return reasons;
}

/**
 * Proof, de-duplication and the store-or-review decision for everything the
 * sources returned. `verify` supplies the validity verdict for a value.
 */
export async function decide(
  person: PersonRef,
  raw: RawFinding[],
  suppression: Suppression,
  verify: (finding: RawFinding) => Promise<Verification>,
): Promise<{ findings: Finding[]; dropped: Dropped[] }> {
  const dropped: Dropped[] = [];
  const drop = (f: RawFinding, why: string) => dropped.push({ kind: f.kind, value: f.value, source: f.source, why });
  const has = (kind: string, source?: string) => person.existing.some((c) => c.kind === kind && (!source || c.source === source));

  // 1. Proof and the rules that need no network.
  const proven: RawFinding[] = [];
  for (const f of raw) {
    if (!verifyQuote(f)) drop(f, "the quote isn't on the source page");
    else if (f.kind === "email" && isSuppressedEmail(f.value, suppression)) drop(f, "on the suppression list");
    else if (has(f.kind, "self")) drop(f, `the member entered their own ${f.kind}`);
    else if (person.existing.some((c) => c.kind === f.kind && c.value.toLowerCase() === f.value)) drop(f, "already on the profile");
    else proven.push(f);
  }

  // 2. The same value from several sources is one finding: keep the surest, and
  //    independent agreement raises confidence a little.
  const byValue = new Map<string, RawFinding[]>();
  for (const f of proven) byValue.set(`${f.kind}:${f.value}`, [...(byValue.get(`${f.kind}:${f.value}`) ?? []), f]);
  const merged = [...byValue.values()].map((group) => {
    const best = [...group].sort((a, b) => Number(a.patternGuessed) - Number(b.patternGuessed) || b.confidence - a.confidence)[0];
    const independent = new Set(group.map((g) => g.sourceDetail)).size;
    return { ...best, confidence: Math.min(0.99, best.confidence + (independent > 1 ? 0.05 : 0)) };
  });

  // 3. Validity. Invalid values go no further, and a pattern-built address
  //    needs a real verifier's "valid".
  const checked: (RawFinding & { verification: Verification })[] = [];
  for (const f of merged) {
    const verification = f.verification?.status === "valid" || f.verification?.status === "invalid" ? f.verification : await verify(f);
    if (verification.status === "invalid") drop(f, `failed the validity check (${verification.method}${verification.detail ? `: ${verification.detail}` : ""})`);
    else if (f.patternGuessed && verification.status !== "valid") drop(f, "pattern-built address that no verifier confirmed");
    else checked.push({ ...f, verification });
  }

  // 4. Two different work emails (or phones) can't both be right: a person decides.
  const workCount = (kind: string) => checked.filter((f) => f.kind === kind && f.label === "work").length;
  const findings = checked.map((c): Finding => {
    const reasons = reviewReasons(c, c.label === "work" && workCount(c.kind) > 1);
    const f: Omit<RawFinding, "pageText"> & { verification: Verification; pageText?: string | null } = { ...c };
    delete f.pageText;
    return { ...f, confidence: Math.round(f.confidence * 100) / 100, reviewReasons: reasons, status: reasons.length ? "pending" : "stored" };
  });
  return { findings, dropped };
}

/** Is there already a usable work value of this kind, so later (scarcer) sources needn't be asked? */
const satisfied = (raw: RawFinding[], kind: string) => raw.some((f) => f.kind === kind && f.label === "work" && !f.patternGuessed && f.confidence >= 0.9);

export async function findContactsFor(
  person: PersonRef,
  sources: ContactSource[],
  ctx: Omit<SourceContext, "note">,
  suppression: Suppression,
): Promise<PersonReport> {
  const report: PersonReport = { person, skipped: null, findings: [], dropped: [], notes: [], sourcesTried: [] };
  if (isSuppressedPerson(person, suppression)) {
    report.skipped = "on the suppression list";
    return report;
  }
  if (person.existing.some((c) => c.kind === "email" && c.source === "self") && person.existing.some((c) => c.kind === "phone" && c.source === "self")) {
    report.skipped = "the member has entered their own email and phone";
    return report;
  }

  const context: SourceContext = { ...ctx, note: (message) => report.notes.push(message) };
  const raw: RawFinding[] = [];
  for (const source of sources) {
    // Free public listings always run; licensed APIs are spent only while a confident work email is still missing.
    if (source.tier !== "free" && source.id !== "fec" && satisfied(raw, "email")) continue;
    report.sourcesTried.push(source.id);
    try {
      raw.push(...(await source.find(person, context)));
    } catch (error) {
      report.notes.push(`${source.label}: ${String((error as Error).message).slice(0, 140)}`);
    }
  }

  const decided = await decide(person, raw, suppression, (f) =>
    f.kind === "email" ? verifyEmail(f.value, ctx.env, ctx.fetchJson) : verifyPhone(f.value, ctx.env, ctx.fetchJson),
  );
  report.findings = decided.findings;
  report.dropped = decided.dropped;
  return report;
}
