import { describe, expect, it } from "vitest";
import { parseSearchText, type SearchVocabulary } from "@/lib/search/parse-query";

const vocab: SearchVocabulary = {
  industries: [
    { slug: "real-estate", name: "Real Estate", synonyms: ["real estate", "property"] },
    { slug: "commercial-real-estate", name: "Commercial Real Estate", synonyms: ["commercial real estate", "cre"] },
    { slug: "finance", name: "Finance & Investing", synonyms: ["finance", "investing"] },
    { slug: "investment-banking", name: "Investment Banking", synonyms: ["investment banking", "ib"] },
    { slug: "technology", name: "Technology", synonyms: ["tech", "technology"] },
  ],
  places: [
    { id: 1, name: "Chicago", state: "IL", metro: "Chicago" },
    { id: 2, name: "St. Paul", state: "MN", metro: "Twin Cities" },
    { id: 3, name: "New York", state: "NY", metro: "New York" },
    { id: 4, name: "Dallas", state: "TX", metro: "Dallas–Fort Worth" },
  ],
};

describe("parseSearchText", () => {
  it("parses industry + city", () => {
    const r = parseSearchText("Show me alumni working in commercial real estate in Chicago", vocab);
    expect(r.query.industrySlugs).toEqual(["commercial-real-estate"]);
    expect(r.placeId).toBe(1);
    expect(r.query.city).toBe("Chicago");
    expect(r.query.text).toBeNull();
    expect(r.needsModel).toBe(false);
  });

  it("understands aliases, radius, class years and open-to", () => {
    const r = parseSearchText("tech mentors in NYC within 25 miles class of '08", vocab);
    expect(r.query.industrySlugs).toEqual(["technology"]);
    expect(r.placeId).toBe(3);
    expect(r.query.radiusMiles).toBe(25);
    expect(r.query.gradYearMin).toBe(2008);
    expect(r.query.gradYearMax).toBe(2008);
    expect(r.query.openTo).toEqual(["mentoring"]);
  });

  it("handles year ranges, decades and punctuation in place names", () => {
    expect(parseSearchText("investment banking 2005-2010", vocab).query).toMatchObject({
      industrySlugs: ["investment-banking"],
      gradYearMin: 2005,
      gradYearMax: 2010,
    });
    expect(parseSearchText("finance grads from the 1990s in St. Paul", vocab)).toMatchObject({
      placeId: 2,
      query: { gradYearMin: 1990, gradYearMax: 1999, industrySlugs: ["finance"] },
    });
  });

  it("keeps unrecognized words as free text (names, employers)", () => {
    const r = parseSearchText("Priya Shah", vocab);
    expect(r.query.text).toBe("priya shah");
    expect(r.needsModel).toBe(false);
  });

  it("asks for a model only when a long phrase matches nothing", () => {
    expect(parseSearchText("people who build rockets for satellites", vocab).needsModel).toBe(true);
  });
});
