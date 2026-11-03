import { describe, expect, it } from "vitest";
import { createAi } from "@/lib/ai";
import { loadAiConfig } from "@/lib/ai/config";
import type { ProfileFacts } from "@/lib/ai/schemas";

const ai = createAi(loadAiConfig({ AI_MODE: "fixture" }));

const facts: ProfileFacts = {
  fullName: "Test Person",
  currentTitle: "Vice President, Commercial Real Estate",
  organizationName: "Lakeshore Realty",
  industryName: "Commercial Real Estate",
  city: "Chicago",
  state: "IL",
  specialties: ["office leasing", "capital markets"],
  bio: null,
  educations: [{ school: "Wisconsin School of Business", degree: "BBA", major: "Real Estate & Urban Land Economics", gradYear: 2009 }],
  positions: [{ title: "Vice President, Commercial Real Estate", organizationName: "Lakeshore Realty", isCurrent: true }],
};

describe("AI layer in fixture mode", () => {
  it("defaults to fixture mode so dev and tests cost nothing", () => {
    expect(loadAiConfig({}).mode).toBe("fixture");
  });

  it("summarizes using only the given facts", async () => {
    const result = await ai.summarizeProfile(facts);
    expect(result.model).toBe("fixture");
    expect(result.summary.join(" ")).toContain("Lakeshore Realty");
    expect(result.summary.join(" ")).toContain("2009");
  });

  it("drops industry slugs and places that aren't in the vocabulary", async () => {
    const parsed = await ai.parseSearchQuery("cre in Chicago", {
      industries: [{ slug: "commercial-real-estate", name: "Commercial Real Estate", synonyms: ["cre"] }],
      places: [{ id: 1, name: "Chicago", state: "IL", metro: "Chicago" }],
    });
    expect(parsed.industrySlugs).toEqual(["commercial-real-estate"]);
    expect(parsed.city).toBe("Chicago");
  });

  it("returns one explanation per candidate and ignores unknown ids", async () => {
    const out = await ai.explainMatches("Expand into Chicago office leasing", [
      { personId: "a", fullName: "A", headline: "Broker at X", city: "Chicago", industryName: "CRE", gradYear: 2010, sharedContext: ["Same major"] },
    ]);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].personId).toBe("a");
  });

  it("produces normalized 1024-dim embeddings where shared words score higher", async () => {
    const [a, b, c] = await ai.embed(["commercial real estate chicago", "chicago commercial real estate broker", "pediatric nurse seattle"]);
    expect(a).toHaveLength(1024);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });

  it("drafts outreach without inventing facts", async () => {
    const draft = await ai.draftOutreach({
      senderName: "Sam",
      senderHeadline: null,
      recipientName: "Jordan Lee",
      recipientHeadline: "Partner at X",
      reason: "I'm moving to Dallas and want to learn the market",
      sharedContext: ["Wisconsin School of Business"],
    });
    expect(draft.body).toContain("Hi Jordan");
  });
});
