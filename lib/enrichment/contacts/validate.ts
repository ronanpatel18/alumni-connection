// Validity checks. An email is only ever shown to members after one of these
// passes; a work address guessed from a company's pattern counts only when a
// real verifier (not just a DNS lookup) says "valid".
//
// Verifiers are licensed APIs, each behind its own key and skipped when the key
// is missing. With no key at all, the free fallback confirms the domain accepts
// mail (MX lookup), reported as "domain_ok" rather than "valid".
import { resolveMx } from "node:dns/promises";
import { emailDomain, normalizeUsPhone } from "./extract";
import type { Verification, VerificationStatus } from "./types";

type Env = Record<string, string | undefined>;
type FetchJson = (url: string, init?: { headers?: Record<string, string> }) => Promise<unknown>;

const SYNTAX = /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;
const stamp = (status: VerificationStatus, method: string, detail?: string): Verification => ({
  status,
  method,
  checked_at: new Date().toISOString(),
  ...(detail ? { detail } : {}),
});

interface Verifier {
  name: string;
  key: string;
  url: (email: string, key: string) => string;
  /** The provider's verdict mapped onto ours. */
  read: (body: Record<string, unknown>) => { status: VerificationStatus; detail?: string };
}

const map = (verdict: unknown, table: Record<string, VerificationStatus>) => ({
  status: table[String(verdict ?? "").toLowerCase()] ?? ("unknown" as VerificationStatus),
  detail: String(verdict ?? ""),
});

// In order of preference. Hunter's verifier shares its free monthly allowance with the finder.
export const EMAIL_VERIFIERS: Verifier[] = [
  {
    name: "zerobounce",
    key: "ZEROBOUNCE_API_KEY",
    url: (email, key) => `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&ip_address=`,
    read: (body) => map(body.status, { valid: "valid", invalid: "invalid", "catch-all": "risky", spamtrap: "invalid", abuse: "risky", do_not_mail: "invalid" }),
  },
  {
    name: "millionverifier",
    key: "MILLIONVERIFIER_API_KEY",
    url: (email, key) => `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`,
    read: (body) => map(body.result, { ok: "valid", invalid: "invalid", disposable: "invalid", catch_all: "risky" }),
  },
  {
    name: "neverbounce",
    key: "NEVERBOUNCE_API_KEY",
    url: (email, key) => `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`,
    read: (body) => map(body.result, { valid: "valid", invalid: "invalid", disposable: "invalid", catchall: "risky" }),
  },
  {
    name: "hunter",
    key: "HUNTER_API_KEY",
    url: (email, key) => `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`,
    read: (body) => hunterVerdict((body.data ?? {}) as Record<string, unknown>),
  },
];

/** Hunter's status: valid | invalid | accept_all | webmail | disposable | unknown. */
export function hunterVerdict(data: Record<string, unknown>) {
  if (data.status === "webmail") return { status: data.result === "deliverable" ? ("valid" as const) : ("unknown" as const), detail: "webmail" };
  return map(data.status, { valid: "valid", invalid: "invalid", disposable: "invalid", accept_all: "risky" });
}

export const configuredVerifier = (env: Env) => EMAIL_VERIFIERS.find((v) => env[v.key]) ?? null;

/** Does the domain accept mail? "unknown" when DNS can't be reached, never a guess. */
export async function checkMx(domain: string, resolve: (domain: string) => Promise<unknown[]> = resolveMx): Promise<VerificationStatus> {
  try {
    const records = await Promise.race([resolve(domain), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))]);
    return records.length ? "domain_ok" : "invalid";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? "invalid" : "unknown";
  }
}

export async function verifyEmail(
  email: string,
  env: Env,
  fetchJson: FetchJson,
  resolve?: (domain: string) => Promise<unknown[]>,
): Promise<Verification> {
  if (!SYNTAX.test(email)) return stamp("invalid", "syntax");
  const mx = await checkMx(emailDomain(email), resolve);
  if (mx === "invalid") return stamp("invalid", "mx", "domain accepts no mail");

  const verifier = configuredVerifier(env);
  if (!verifier) return stamp(mx, "mx");
  try {
    const verdict = verifier.read((await fetchJson(verifier.url(email, env[verifier.key]!))) as Record<string, unknown>);
    return stamp(verdict.status, verifier.name, verdict.detail);
  } catch (error) {
    // Out of credits or unreachable: fall back to what DNS told us, never to "valid".
    return stamp(mx, "mx", `${verifier.name} unavailable: ${String((error as Error).message).slice(0, 80)}`);
  }
}

/**
 * Phone check. Twilio Lookup's basic request (formatting and validity) is free
 * and used when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are set; line type is a
 * paid add-on and is only requested with TWILIO_LOOKUP_LINE_TYPE=1. Otherwise
 * the number is only known to be well-formed.
 */
export async function verifyPhone(e164: string, env: Env, fetchJson: FetchJson): Promise<Verification> {
  if (normalizeUsPhone(e164) !== e164) return stamp("invalid", "format");
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return stamp("unknown", "format", "well-formed; not looked up");
  try {
    const fields = env.TWILIO_LOOKUP_LINE_TYPE === "1" ? "?Fields=line_type_intelligence" : "";
    const body = (await fetchJson(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}${fields}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
    })) as { valid?: boolean; line_type_intelligence?: { type?: string } | null };
    return stamp(body.valid ? "valid" : "invalid", "twilio", body.line_type_intelligence?.type ?? undefined);
  } catch (error) {
    return stamp("unknown", "format", `twilio unavailable: ${String((error as Error).message).slice(0, 80)}`);
  }
}
