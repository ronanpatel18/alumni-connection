import { describe, expect, it } from "vitest";
import { createAi } from "@/lib/ai";
import { loadAiConfig } from "@/lib/ai/config";
import { isGrounded } from "@/lib/ai/grounding";
import { rankUserPrompt } from "@/lib/ai/prompts";
import { type CandidateForRanking, parsedQuerySchema, rankedMatchesSchema } from "@/lib/ai/schemas";
import { askChips, askEvidence, type AskFilters, askHref, askText, effectiveFilters } from "@/lib/search/ask";
import { parseSearchText, type SearchVocabulary } from "@/lib/search/parse-query";

const vocab: SearchVocabulary = {
  industries: [
    { slug: "venture-capital", name: "Venture Capital", synonyms: ["venture capital", "vc"] },
    { slug: "technology", name: "Technology", synonyms: ["tech", "technology"] },
  ],
  places: [
    { id: 7, name: "Austin", state: "TX", metro: "Austin" },
    { id: 1, name: "Chicago", state: "IL", metro: "Chicago" },
  ],
};

const REQUEST = "I'm moving to Austin and want to break into climate tech VC, ideally someone who graduated in the 2010s and mentors.";

const candidate = (over: Partial<CandidateForRanking> = {}): CandidateForRanking => ({
  personId: "11111111-1111-1111-1111-111111111111",
  fullName: "Dana Kim",
  title: "Partner",
  organizationName: "Lakeshore Ventures",
  industryName: "Venture Capital",
  city: "Austin",
  state: "TX",
  gradYear: 2012,
  degree: "BBA",
  seniority: "partner",
  openTo: ["mentoring"],
  specialties: ["climate tech"],
  summary: [],
  groups: [],
  ...over,
});

describe("rule parser on a described goal (the free path and the fallback)", () => {
  it("reads the city, field, decade and mentoring from the example request", () => {
    const r = parseSearchText(REQUEST, vocab);
    expect(r.placeId).toBe(7);
    expect(r.query.industrySlugs).toEqual(["technology", "venture-capital"]);
    expect([r.query.gradYearMin, r.query.gradYearMax]).toEqual([2010, 2019]);
    expect(r.query.openTo).toEqual(["mentoring"]);
    expect(r.query.keywords).toContain("climate");
    expect(r.query.goal).toBeNull();
    expect(r.needsModel).toBe(false);
  });

  it("reads career levels only from unambiguous plurals, and keeps the words as keywords", () => {
    expect(parseSearchText("founders and executives in tech", vocab).query.seniority).toEqual(["c_suite", "owner"]);
    const director = parseSearchText("director of marketing", vocab);
    expect(director.query.seniority).toEqual([]);
    expect(director.query.text).toBe("director marketing");
  });
});

describe("parsed-query schema", () => {
  const base = { text: null, industrySlugs: [], city: null, state: null, radiusMiles: null, gradYearMin: null, gradYearMax: null, openTo: [] };

  it("requires the new fields, so strict JSON decoding stays possible", () => {
    expect(parsedQuerySchema.safeParse(base).success).toBe(false);
    expect(parsedQuerySchema.safeParse({ ...base, seniority: ["vp"], keywords: ["climate"], goal: "Meet climate investors." }).success).toBe(true);
  });

  it("rejects unknown career levels and extra keys", () => {
    expect(parsedQuerySchema.safeParse({ ...base, seniority: ["boss"], keywords: [], goal: null }).success).toBe(false);
    expect(parsedQuerySchema.safeParse({ ...base, seniority: [], keywords: [], goal: null, score: 0.9 }).success).toBe(false);
  });

  it("caps a ranking at the shortlist size", () => {
    const matches = Array.from({ length: 31 }, (_, i) => ({ ref: `p${i + 1}`, why: "Relevant." }));
    expect(rankedMatchesSchema.safeParse({ matches }).success).toBe(false);
  });
});

describe("AI layer in fixture mode: prompt search", () => {
  const ai = createAi(loadAiConfig({ AI_MODE: "fixture" }));

  it("interprets a request offline, dropping places and industries outside the vocabulary", async () => {
    const parsed = await ai.parseSearchQuery(REQUEST, { ...vocab, places: [vocab.places[1]] });
    expect(parsed.city).toBeNull();
    expect(parsed.radiusMiles).toBeNull();
    expect(parsed.industrySlugs).toEqual(["technology", "venture-capital"]);
    expect(parsed.openTo).toEqual(["mentoring"]);
  });

  it("returns every candidate exactly once, with reasons built only from their facts", async () => {
    const people = [candidate(), candidate({ personId: "22222222-2222-2222-2222-222222222222", fullName: "Lee Park", title: null, organizationName: null, industryName: null, city: null, openTo: [] })];
    const ranked = await ai.rankMatches(REQUEST, people);
    expect(ranked.map((r) => r.personId)).toEqual(people.map((p) => p.personId));
    expect(ranked[0].why).toContain("Lakeshore Ventures");
    expect(ranked[0].why).toContain("open to mentoring");
    expect(ranked[1].why).toBe("UW–Madison alumnus in your results.");
    expect(await ai.rankMatches(REQUEST, [])).toEqual([]);
  });

  it("names the embedding space, and sends the model short refs rather than ids", () => {
    expect(ai.embedModel).toBe("fixture");
    const prompt = rankUserPrompt(REQUEST, [candidate()]);
    expect(prompt).toContain('"ref":"p1"');
    expect(prompt).not.toContain("11111111");
  });
});

describe("isGrounded (no invented details in a reason)", () => {
  const facts = JSON.stringify({ title: "Partner", employer: "Lakeshore Ventures", location: "Austin, TX", uwDegree: "BBA 2012", specialties: ["climate tech"] });
  const allowed = `${facts} ${REQUEST}`;

  it("accepts a reason that restates the profile and the member's own words", () => {
    expect(isGrounded("Partner at Lakeshore Ventures in Austin, focused on climate tech, and a 2012 graduate.", allowed)).toBe(true);
    expect(isGrounded("Works in VC in Austin. Their focus on climate tech fits your move.", allowed)).toBe(true);
  });

  it("rejects an employer, place or year that isn't in the facts", () => {
    expect(isGrounded("Partner at Lakeshore Ventures who previously worked at Goldman Sachs.", allowed)).toBe(false);
    expect(isGrounded("Partner based in Denver with a climate tech focus.", allowed)).toBe(false);
    expect(isGrounded("Has invested in climate tech since 2009.", allowed)).toBe(false);
    expect(isGrounded("Leads a $400 million climate fund.", allowed)).toBe(false);
  });
});

describe("understood filters as editable chips", () => {
  const parsed = parseSearchText(REQUEST, vocab);
  const names = { industry: (slug: string) => vocab.industries.find((i) => i.slug === slug)?.name ?? slug, place: { name: "Austin", state: "TX" } };

  it("uses the parsed request until the member edits something", () => {
    const filters = effectiveFilters({ ask: REQUEST }, parsed.query, parsed.placeId);
    expect(filters).toMatchObject({ placeId: 7, radius: 50, gradFrom: 2010, gradTo: 2019, openTo: ["mentoring"], confirmedOnly: false });
  });

  it("after an edit, takes filters only from the URL, so a removed filter stays removed", () => {
    const filters = effectiveFilters({ ask: REQUEST, edited: "1", industry: "technology" }, parsed.query, parsed.placeId);
    expect(filters).toMatchObject({ placeId: null, industrySlugs: ["technology"], gradFrom: null, openTo: [] });
  });

  it("gives each filter a removal link that keeps the request and the other filters", () => {
    const filters = effectiveFilters({ ask: REQUEST }, parsed.query, parsed.placeId);
    const chips = askChips(REQUEST, filters, names);
    expect(chips.map((c) => c.label)).toEqual(["Near: Austin, TX (50 mi)", "Industry: Technology", "Industry: Venture Capital", "Class: 2010–2019", "Open to: Mentoring"]);
    const url = new URL(chips[0].href, "http://x");
    expect(url.pathname).toBe("/search/ask");
    expect(url.searchParams.get("ask")).toBe(REQUEST);
    expect(url.searchParams.get("edited")).toBe("1");
    expect(url.searchParams.get("place")).toBeNull();
    expect(url.searchParams.getAll("industry")).toEqual(["technology", "venture-capital"]);
    // Following the link reproduces exactly the remaining filters.
    const after = effectiveFilters(Object.fromEntries([...url.searchParams.keys()].map((k) => [k, url.searchParams.getAll(k)])), parsed.query, parsed.placeId);
    expect(after).toEqual({ ...filters, placeId: null });
  });

  it("trims and caps the request text", () => {
    expect(askText({ ask: `  ${"x".repeat(600)}  ` })).toHaveLength(500);
    expect(askHref("a b", { industrySlugs: [], placeId: null, radius: 50, gradFrom: null, gradTo: null, openTo: [], seniority: [], confirmedOnly: true })).toBe(
      "/search/ask?ask=a+b&edited=1&confirmed=1",
    );
  });
});

describe("askEvidence", () => {
  const filters: AskFilters = { industrySlugs: ["venture-capital"], placeId: 7, radius: 50, gradFrom: 2010, gradTo: 2019, openTo: ["mentoring", "investing"], seniority: ["partner"], confirmedOnly: false };
  const person = { industry_name: "Venture Capital", city: "Austin", metro: "Austin", grad_year: 2012, seniority: "partner", open_to: ["mentoring"], status: "verified" };

  it("lists only the preferences this person actually meets, as plain facts", () => {
    expect(askEvidence({ ...person, matched: ["industry", "class", "open_to", "seniority"] }, filters)).toEqual([
      "Austin",
      "Venture Capital",
      "Class of 2012",
      "Partner",
      "open to mentoring",
      "confirmed profile",
    ]);
  });

  it("says so when someone is there on similarity alone, and never shows a score", () => {
    const lines = askEvidence({ ...person, status: "seeded", matched: [] }, { ...filters, placeId: null });
    expect(lines).toEqual(["similar to your description"]);
    expect(lines.join(" ")).not.toMatch(/\d+%|score/i);
  });
});
