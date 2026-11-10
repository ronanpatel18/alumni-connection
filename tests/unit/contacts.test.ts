import { describe, expect, it } from "vitest";
import { attribute, extractCandidates, localPartMatchesName, normalizeUsPhone, verifyQuote } from "@/lib/enrichment/contacts/extract";
import { buildSuppression, decide, findContactsFor, sha256 } from "@/lib/enrichment/contacts/pipeline";
import { apollo, clay, companyPages, CONTACT_SOURCES, fecRecords, hunter, npiRegistry, peopleDataLabs, peopleSearch } from "@/lib/enrichment/contacts/sources";
import { missingOwnContacts } from "@/lib/own-contacts";
import type { PersonRef, RawFinding, SearchHit, SourceContext, Verification } from "@/lib/enrichment/contacts/types";
import { checkMx, hunterVerdict, verifyEmail, verifyPhone } from "@/lib/enrichment/contacts/validate";

// Everything here is fictional: example.com addresses and unassigned numbers.
const person = (over: Partial<PersonRef> = {}): PersonRef => ({
  id: "p1",
  institutionId: "i1",
  fullName: "Jane Kowalczyk",
  firstName: "Jane",
  lastName: "Kowalczyk",
  title: "Managing Director",
  organizationName: "Lakeshore Capital Partners",
  orgDomain: "lakeshore.example.com",
  industrySlug: "finance",
  city: "Madison",
  state: "WI",
  existing: [],
  ...over,
});

const TEAM_PAGE = `Our team
Robert Alvarez, Chief Executive Officer
ralvarez@lakeshore.example.com | (608) 262-0001

Jane Kowalczyk, Managing Director
Lakeshore Capital Partners, Madison
jane.kowalczyk@lakeshore.example.com | (608) 262-0002

General inquiries: info@lakeshore.example.com or 800-262-0003`;

const ok = (status: Verification["status"], method = "test"): Verification => ({ status, method, checked_at: "2026-11-10T00:00:00Z" });
const noSuppression = buildSuppression([]);

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  kind: "email",
  value: "jane.kowalczyk@lakeshore.example.com",
  label: "work",
  source: "web",
  sourceDetail: "lakeshore.example.com",
  sourceUrl: "https://lakeshore.example.com/team",
  quote: "Jane Kowalczyk, Managing Director Lakeshore Capital Partners, Madison jane.kowalczyk@lakeshore.example.com | (608) 262-0002",
  confidence: 0.95,
  patternGuessed: false,
  pageText: TEAM_PAGE,
  ...over,
});

function context(over: Partial<SourceContext> = {}): SourceContext & { notes: string[] } {
  const notes: string[] = [];
  return {
    notes,
    env: {},
    search: async () => [],
    fetchPage: async () => null,
    fetchJson: async () => ({}),
    note: (message) => notes.push(message),
    ...over,
  };
}

describe("reading values off a page", () => {
  it("finds emails and phones exactly as written, and nothing else", () => {
    const found = extractCandidates(TEAM_PAGE);
    expect(found.filter((c) => c.kind === "email").map((c) => c.value)).toEqual([
      "ralvarez@lakeshore.example.com",
      "jane.kowalczyk@lakeshore.example.com",
      "info@lakeshore.example.com",
    ]);
    // The toll-free switchboard isn't anyone's number.
    expect(found.filter((c) => c.kind === "phone").map((c) => c.value)).toEqual(["+16082620001", "+16082620002"]);
  });

  it("rejects malformed, fictional, toll-free and masked numbers", () => {
    expect(normalizeUsPhone("(608) 262-0002")).toBe("+16082620002");
    expect(normalizeUsPhone("+1 608.262.0002")).toBe("+16082620002");
    for (const bad of ["608-555-0142", "800-262-0003", "123-456-7890", "(608) 262-00", "111-111-1111"]) expect(normalizeUsPhone(bad)).toBeNull();
    expect(extractCandidates("Call (608) 262-****, or see order 2024-608-262-0002-11")).toEqual([]);
    expect(extractCandidates("Email. j***oh@gmail.com")).toEqual([]);
  });

  it("gives each value to the person it sits beside, not to a colleague on the same page", () => {
    const jane = person();
    const byValue = new Map(extractCandidates(TEAM_PAGE).map((c) => [c.value, attribute(jane, TEAM_PAGE, c)]));
    expect(byValue.get("jane.kowalczyk@lakeshore.example.com")).toEqual({ confidence: 0.95, label: "work" });
    expect(byValue.get("ralvarez@lakeshore.example.com")).toBeNull();
    expect(byValue.get("info@lakeshore.example.com")).toBeNull(); // a shared inbox is nobody's
    expect(byValue.get("+16082620002")?.label).toBe("work");
    expect(byValue.get("+16082620001")).toBeNull();
  });

  it("attributes nothing on a page that never names the person", () => {
    const page = "Contact our managing director at jane.kowalczyk@lakeshore.example.com";
    expect(attribute(person(), page, extractCandidates(page)[0])).toBeNull();
  });

  it("labels a free-mail address personal and matches common address patterns", () => {
    const page = "Jane Kowalczyk can be reached at jkowalczyk@gmail.com";
    expect(attribute(person(), page, extractCandidates(page)[0])).toEqual({ confidence: 0.9, label: "personal" });
    const who = { firstName: "Jane", lastName: "Kowalczyk" };
    for (const local of ["jane.kowalczyk", "jkowalczyk", "kowalczykj", "janek", "kowalczyk"]) expect(localPartMatchesName(`${local}@x.example.com`, who)).toBe(true);
    for (const local of ["jk", "jane", "ralvarez"]) expect(localPartMatchesName(`${local}@x.example.com`, who)).toBe(false);
    expect(localPartMatchesName("lee@x.example.com", { firstName: "Amy", lastName: "Lee" })).toBe(false); // short surnames collide
  });
});

describe("verifyQuote (no source, no field)", () => {
  it("keeps a value whose quote is on the page", () => {
    expect(verifyQuote(raw())).toBe(true);
    expect(verifyQuote(raw({ kind: "phone", value: "+16082620002" }))).toBe(true);
  });

  it("drops a value that isn't on the page, or whose quote doesn't contain it", () => {
    expect(verifyQuote(raw({ value: "j.kowalczyk@lakeshore.example.com", quote: "Jane Kowalczyk j.kowalczyk@lakeshore.example.com" }))).toBe(false);
    expect(verifyQuote(raw({ quote: "Jane Kowalczyk, Managing Director" }))).toBe(false);
    expect(verifyQuote(raw({ kind: "phone", value: "+16082629999" }))).toBe(false);
  });

  it("accepts a licensed API's response as its own record", () => {
    expect(verifyQuote(raw({ pageText: null, quote: "Hunter email-finder: …" }))).toBe(true);
  });
});

describe("decide: store privately, send to review, or drop", () => {
  const verified = async () => ok("valid");

  it("stores a confident, verified work email privately with no review reasons", async () => {
    const { findings, dropped } = await decide(person(), [raw()], noSuppression, verified);
    expect(dropped).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: "stored", reviewReasons: [], confidence: 0.95 });
    expect(findings[0]).not.toHaveProperty("pageText");
  });

  it("sends low-confidence, personal and third-party phone findings to review", async () => {
    const { findings } = await decide(
      person(),
      [
        raw({ confidence: 0.6 }),
        raw({ value: "jkowalczyk@gmail.com", label: "personal", quote: "ralvarez@lakeshore.example.com", pageText: "jkowalczyk@gmail.com ralvarez@lakeshore.example.com".replace("ralvarez", "x") }),
        raw({ kind: "phone", value: "+16082620002", confidence: 0.9 }),
      ],
      noSuppression,
      verified,
    );
    const reasons = Object.fromEntries(findings.map((f) => [f.value, f.reviewReasons]));
    expect(reasons["jane.kowalczyk@lakeshore.example.com"]).toEqual(["low_confidence"]);
    expect(reasons["+16082620002"]).toEqual(["third_party_phone"]);
    expect(findings.every((f) => f.status === "pending")).toBe(true);
  });

  it("lets a registry's practice phone through, and flags two different work emails as a conflict", async () => {
    const npi = raw({ kind: "phone", value: "+16082620002", source: "registry", sourceDetail: "npi", confidence: 0.85, pageText: null });
    expect((await decide(person(), [npi], noSuppression, verified)).findings[0].status).toBe("stored");

    const other = raw({ value: "jkowalczyk@lakeshore.example.com", quote: "Jane Kowalczyk jkowalczyk@lakeshore.example.com", pageText: "Jane Kowalczyk jkowalczyk@lakeshore.example.com", sourceDetail: "news.example.com" });
    const { findings } = await decide(person(), [raw(), other], noSuppression, verified);
    expect(findings.map((f) => f.reviewReasons)).toEqual([["conflict"], ["conflict"]]);
  });

  it("merges the same value from two sources and nudges confidence up", async () => {
    const again = raw({ source: "registry", sourceDetail: "wisbar.org", confidence: 0.75 });
    const { findings } = await decide(person(), [again, raw({ confidence: 0.9 })], noSuppression, verified);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ source: "web", confidence: 0.95 });
  });

  it("drops unproven, invalid, suppressed and already-known values, saying why", async () => {
    const suppression = buildSuppression([{ full_name: "Someone Else", email_sha256: sha256("gone@lakeshore.example.com") }]);
    const gone = raw({ value: "gone@lakeshore.example.com", quote: "Jane Kowalczyk gone@lakeshore.example.com", pageText: "Jane Kowalczyk gone@lakeshore.example.com" });
    const invented = raw({ value: "jane@lakeshore.example.com", quote: "jane@lakeshore.example.com" });
    const bounced = raw({ value: "jk@lakeshore.example.com", quote: "Jane Kowalczyk jk@lakeshore.example.com", pageText: "Jane Kowalczyk jk@lakeshore.example.com" });
    const { findings, dropped } = await decide(
      person({ existing: [{ kind: "email", value: "Jane.Kowalczyk@lakeshore.example.com", source: "roster" }] }),
      [gone, invented, bounced, raw()],
      suppression,
      async (f) => ok(f.value.startsWith("jk@") ? "invalid" : "valid"),
    );
    expect(findings).toEqual([]);
    expect(dropped.map((d) => d.why)).toEqual([
      "on the suppression list",
      "the quote isn't on the source page",
      "already on the profile",
      "failed the validity check (test)",
    ]);
  });

  it("never looks for a detail the member has entered themselves", async () => {
    const mine = person({ existing: [{ kind: "email", value: "me@elsewhere.example.com", source: "self" }] });
    const { findings, dropped } = await decide(mine, [raw()], noSuppression, verified);
    expect(findings).toEqual([]);
    expect(dropped[0].why).toBe("the member entered their own email");
  });

  it("keeps a pattern-built address only when a verifier says valid, and always labels it for review", async () => {
    const guess = raw({ source: "hunter", sourceDetail: "hunter-pattern", patternGuessed: true, pageText: null, confidence: 0.9 });
    const unconfirmed = await decide(person(), [guess], noSuppression, async () => ok("domain_ok", "mx"));
    expect(unconfirmed.findings).toEqual([]);
    expect(unconfirmed.dropped[0].why).toBe("pattern-built address that no verifier confirmed");

    const confirmed = await decide(person(), [guess], noSuppression, verified);
    expect(confirmed.findings[0]).toMatchObject({ status: "pending", reviewReasons: ["pattern"], patternGuessed: true });
  });

  it("marks an email with only a risky verdict as unverified", async () => {
    const { findings } = await decide(person(), [raw()], noSuppression, async () => ok("risky"));
    expect(findings[0].reviewReasons).toEqual(["unverified"]);
  });
});

describe("validity checks", () => {
  const mxOk = async () => [{ exchange: "mx.example.com" }];
  const never = async () => {
    throw new Error("no network in tests");
  };

  it("without a verifier key, reports only that the domain accepts mail", async () => {
    expect(await verifyEmail("jane@lakeshore.example.com", {}, never, mxOk)).toMatchObject({ status: "domain_ok", method: "mx" });
    expect(await verifyEmail("not an email", {}, never, mxOk)).toMatchObject({ status: "invalid", method: "syntax" });
    expect(await checkMx("x.example.com", async () => [])).toBe("invalid");
    expect(await checkMx("x.example.com", async () => Promise.reject(Object.assign(new Error("nx"), { code: "ENOTFOUND" })))).toBe("invalid");
    expect(await checkMx("x.example.com", async () => Promise.reject(new Error("dns down")))).toBe("unknown");
  });

  it("uses the configured verifier, and never upgrades to valid when it fails", async () => {
    const calls: string[] = [];
    const zb = async (url: string) => (calls.push(new URL(url).host), { status: "catch-all" });
    expect(await verifyEmail("jane@lakeshore.example.com", { ZEROBOUNCE_API_KEY: "k" }, zb, mxOk)).toMatchObject({ status: "risky", method: "zerobounce" });
    expect(calls).toEqual(["api.zerobounce.net"]);
    expect(await verifyEmail("jane@lakeshore.example.com", { MILLIONVERIFIER_API_KEY: "k" }, async () => ({ result: "ok" }), mxOk)).toMatchObject({ status: "valid" });
    expect(await verifyEmail("jane@lakeshore.example.com", { HUNTER_API_KEY: "k" }, never, mxOk)).toMatchObject({ status: "domain_ok", method: "mx" });
    expect(hunterVerdict({ status: "accept_all" }).status).toBe("risky");
    expect(hunterVerdict({ status: "webmail", result: "deliverable" }).status).toBe("valid");
  });

  it("checks phones by format, and by Twilio Lookup only when keys are set", async () => {
    expect(await verifyPhone("+16082620002", {}, never)).toMatchObject({ status: "unknown", method: "format" });
    expect(await verifyPhone("+16085550142", {}, never)).toMatchObject({ status: "invalid" });
    const env = { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" };
    let asked = "";
    const twilio = async (url: string) => ((asked = url), { valid: true });
    expect(await verifyPhone("+16082620002", env, twilio)).toMatchObject({ status: "valid", method: "twilio" });
    expect(asked).not.toContain("line_type"); // the paid add-on is off unless asked for
  });
});

describe("sources", () => {
  const hit = (url: string, snippet = "Jane Kowalczyk, Managing Director"): SearchHit => ({ url, title: "Team", snippet });

  it("company pages: reads the employer's page, skipping LinkedIn, people-search and vendor pages", async () => {
    const fetched: string[] = [];
    const ctx = context({
      search: async () => [hit("https://lakeshore.example.com/team"), hit("https://www.linkedin.com/in/jane"), hit("https://www.spokeo.com/Jane-Kowalczyk"), hit("https://rocketreach.co/jane")],
      fetchPage: async (url) => (fetched.push(url), TEAM_PAGE),
    });
    const found = await companyPages.find(person(), ctx);
    expect(new Set(fetched)).toEqual(new Set(["https://lakeshore.example.com/team"]));
    expect(new Set(found.map((f) => f.value))).toEqual(new Set(["jane.kowalczyk@lakeshore.example.com", "+16082620002"]));
    expect(found.every((f) => f.source === "web" && f.sourceDetail === "lakeshore.example.com" && verifyQuote(f))).toBe(true);
  });

  it("a blocked page yields nothing rather than a guess", async () => {
    const ctx = context({ search: async () => [hit("https://lakeshore.example.com/team")], fetchPage: async () => null });
    expect(await companyPages.find(person(), ctx)).toEqual([]);
  });

  it("people-search: personal, low confidence, and only with the person's city beside the value", async () => {
    const page = "Jane Kowalczyk, age 50s, Madison, WI. Phone: (608) 262-0002";
    const elsewhere = "Jane Kowalczyk, age 30s, Tampa, FL. Phone: (813) 262-0002";
    const ctx = context({ search: async () => [hit("https://www.whitepages.com/name/Jane-Kowalczyk", page), hit("https://www.spokeo.com/Jane-Kowalczyk", elsewhere)] });
    const found = await peopleSearch.find(person(), ctx);
    expect(found.map((f) => f.value)).toEqual(["+16082620002"]);
    // Seen in a live dry run: a relative's listing that mentions a matching name is not this person's.
    const relative = context({ search: async () => [hit("https://www.whitepages.com/name/Maura-Kowalczyk", `Madison, WI ... Declan Jane Kowalczyk. Cell phone. (608) 262-0002`)] });
    expect(await peopleSearch.find(person(), relative)).toEqual([]);
    expect(found[0]).toMatchObject({ source: "people_search", label: "personal", sourceDetail: "whitepages.com" });
    expect(found[0].confidence).toBeLessThanOrEqual(0.5);
    const { findings } = await decide(person(), found, noSuppression, async () => ok("unknown", "format"));
    expect(findings[0]).toMatchObject({ status: "pending", reviewReasons: ["low_confidence", "personal", "third_party_phone"] });
  });

  it("NPI: only for health care, only an exact single match, with the city as the identity check", async () => {
    const api = async () => ({
      results: [{ number: 1234567890, basic: { first_name: "JANE", last_name: "KOWALCZYK" }, addresses: [{ address_purpose: "LOCATION", city: "MADISON", state: "WI", telephone_number: "608-262-0002" }] }],
    });
    expect(await npiRegistry.find(person(), context({ fetchJson: api }))).toEqual([]); // works in finance: not asked
    const doctor = person({ title: "Physician", industrySlug: "healthcare" });
    const [found] = await npiRegistry.find(doctor, context({ fetchJson: api }));
    expect(found).toMatchObject({ kind: "phone", value: "+16082620002", source: "registry", sourceDetail: "npi", confidence: 0.85, pageText: null });
    expect((await npiRegistry.find({ ...doctor, city: "Milwaukee" }, context({ fetchJson: api })))[0].confidence).toBe(0.6);

    const two = async () => ({ results: [...(await api()).results, ...(await api()).results] });
    const ctx = context({ fetchJson: two });
    expect(await npiRegistry.find(doctor, ctx)).toEqual([]);
    expect(ctx.notes[0]).toMatch(/2 providers share this name/);
  });

  it("Hunter: an address with cited pages is 'found'; one without is a pattern guess; the key never lands in a stored URL", async () => {
    const env = { HUNTER_API_KEY: "secret-key" };
    const cited = async () => ({ data: { email: "Jane.Kowalczyk@lakeshore.example.com", score: 97, sources: [{ uri: "https://lakeshore.example.com/team" }], verification: { status: "valid" } } });
    const [found] = await hunter.find(person(), context({ env, fetchJson: cited }));
    expect(found).toMatchObject({ value: "jane.kowalczyk@lakeshore.example.com", patternGuessed: false, sourceDetail: "hunter-found", sourceUrl: "https://lakeshore.example.com/team" });
    expect(found.verification?.status).toBe("valid");

    let asked = "";
    const guessed = async (url: string) => ((asked = url), { data: { email: "jkowalczyk@lakeshore.example.com", score: 60, sources: [] } });
    const [guess] = await hunter.find(person({ orgDomain: null }), context({ env, fetchJson: guessed }));
    expect(asked).toContain("company=Lakeshore%20Capital%20Partners");
    expect(guess).toMatchObject({ patternGuessed: true, sourceDetail: "hunter-pattern" });
    expect(guess.sourceUrl).not.toContain("secret-key");
    expect(guess.quote).toContain("address pattern");

    // Seen in a live dry run: a search-engine link is not a page that shows the address.
    const searchLink = async () => ({ data: { email: "jane.kowalczyk@lakeshore.example.com", score: 96, sources: [{ uri: "https://www.google.com/search?q=site:linkedin.com%20jane" }] } });
    expect((await hunter.find(person(), context({ env, fetchJson: searchLink })))[0]).toMatchObject({ patternGuessed: true, sourceDetail: "hunter-pattern" });
  });

  it("keyed and paid sources are off without a key, and paid adapters stay stubs even with one", async () => {
    expect(hunter.status({}).enabled).toBe(false);
    expect(fecRecords.status({}).enabled).toBe(false);
    for (const paid of [peopleDataLabs, apollo, clay]) {
      expect(paid.tier).toBe("paid");
      expect(paid.status({ PDL_API_KEY: "k", APOLLO_API_KEY: "k", CLAY_API_KEY: "k" }).enabled).toBe(false);
      await expect(paid.find(person(), context())).rejects.toThrow(/stub/);
    }
    expect(CONTACT_SOURCES.map((s) => s.tier)).toEqual(["free", "free", "free", "free", "free", "keyed", "keyed", "paid", "paid", "paid", "paid"]);
  });

  it("FEC records never produce a contact detail", async () => {
    const ctx = context({ env: { FEC_API_KEY: "k" }, fetchJson: async () => ({ results: [{ contributor_employer: "LAKESHORE CAPITAL PARTNERS", contributor_city: "MADISON" }] }) });
    expect(await fecRecords.find(person(), ctx)).toEqual([]);
    expect(ctx.notes[0]).toMatch(/same employer/);
  });
});

describe("findContactsFor", () => {
  const sources = [companyPages];
  const ctx = (calls: string[]) => ({
    env: {},
    search: async (query: string) => (calls.push(query), [{ url: "https://lakeshore.example.com/team", title: "Team", snippet: "Jane Kowalczyk, Managing Director" }]),
    fetchPage: async () => TEAM_PAGE,
    fetchJson: async () => ({}),
  });

  it("checks the suppression list before asking any source anything", async () => {
    const calls: string[] = [];
    const report = await findContactsFor(person(), sources, ctx(calls), buildSuppression([{ full_name: "jane kowalczyk ", email_sha256: null }]));
    expect(report.skipped).toBe("on the suppression list");
    expect(calls).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it("skips a member who has entered both details themselves", async () => {
    const calls: string[] = [];
    const mine = person({ existing: [{ kind: "email", value: "a@b.example.com", source: "self" }, { kind: "phone", value: "+16082620009", source: "self" }] });
    expect((await findContactsFor(mine, sources, ctx(calls), noSuppression)).skipped).toMatch(/their own email and phone/);
    expect(calls).toEqual([]);
  });

  it("reports a failing source as a note and carries on", async () => {
    const broken = { ...companyPages, id: "broken", label: "Broken source", find: async () => Promise.reject(new Error("search is down")) };
    const report = await findContactsFor(person(), [broken, clay], ctx([]), noSuppression);
    expect(report.notes).toEqual(["Broken source: search is down", expect.stringMatching(/stub adapter/)]);
    expect(report.findings).toEqual([]);
  });
});

describe("members adding their own details", () => {
  it("prompts only for what the member hasn't entered themselves", () => {
    expect(missingOwnContacts([])).toEqual(["email", "phone"]);
    expect(missingOwnContacts([{ kind: "email", source: "web" }, { kind: "phone", source: "self" }])).toEqual(["email"]);
    expect(missingOwnContacts([{ kind: "email", source: "self" }, { kind: "phone", source: "self" }])).toEqual([]);
  });
});
