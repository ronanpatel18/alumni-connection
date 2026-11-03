import { describe, expect, it } from "vitest";
import type { Enrichment } from "@/lib/ai/schemas";
import { verifyEnrichment } from "@/lib/enrichment/verify";

const bio = {
  id: "S1",
  url: "https://business.wisc.edu/board-member/profile/jon-d-hammes/",
  text: "Jon has been an active participant in the Milwaukee community.\n\nJon earned an M.S. degree in Real Estate and Urban Land Economics from the University of Wisconsin and a BBA degree from the University Wisconsin-Milwaukee.",
};
const slugs = new Set(["real-estate-development", "commercial-real-estate"]);

const base: Enrichment = {
  uwMadisonStatus: "unknown",
  uwMadisonEvidence: null,
  educations: [],
  location: { city: null, state: null, evidence: null, sourceId: null },
  industrySlug: null,
  specialties: [],
};

describe("verifyEnrichment", () => {
  it("keeps a UW degree whose quote is in the source, and rates plain 'University of Wisconsin' as likely", () => {
    const v = verifyEnrichment(
      {
        ...base,
        uwMadisonStatus: "source_stated",
        educations: [
          { institution: "University of Wisconsin", isUwMadison: true, degree: "M.S.", major: "Real Estate and Urban Land Economics", gradYear: null, evidence: "an M.S. degree in Real Estate and Urban Land Economics from the University of Wisconsin", sourceId: "S1" },
        ],
      },
      [bio],
      slugs,
    );
    expect(v.uwEducations).toEqual([expect.objectContaining({ degree: "MS", major: "Real Estate and Urban Land Economics" })]);
    expect(v.alumniStatus).toBe("likely");
  });

  it("drops invented degrees whose quote isn't in any source", () => {
    const v = verifyEnrichment(
      { ...base, uwMadisonStatus: "source_stated", educations: [{ institution: "UW–Madison", isUwMadison: true, degree: "MBA", major: null, gradYear: 1990, evidence: "earned his MBA from UW–Madison in 1990", sourceId: "S1" }] },
      [bio],
      slugs,
    );
    expect(v.uwEducations).toHaveLength(0);
    expect(v.alumniStatus).toBe("unknown");
    expect(v.rejected[0]).toMatch(/quote not found/);
  });

  it("does not count other UW campuses as UW–Madison", () => {
    const v = verifyEnrichment(
      { ...base, educations: [{ institution: "UW–Milwaukee", isUwMadison: true, degree: "BBA", major: null, gradYear: null, evidence: "a BBA degree from the University Wisconsin-Milwaukee", sourceId: "S1" }] },
      [bio],
      slugs,
    );
    expect(v.uwEducations).toHaveLength(0);
  });

  it("tolerates curly quotes and dash differences but rejects unknown industries", () => {
    const source = { id: "S1", url: "x", text: "She holds her BBA from the University of Wisconsin–Madison." };
    const v = verifyEnrichment(
      { ...base, industrySlug: "made-up", educations: [{ institution: "UW–Madison", isUwMadison: true, degree: "BBA", major: null, gradYear: null, evidence: "BBA from the University of Wisconsin-Madison", sourceId: "S1" }] },
      [source],
      slugs,
    );
    expect(v.alumniStatus).toBe("source_stated");
    expect(v.industrySlug).toBeNull();
  });
});

describe("verifyEnrichment: stricter alumni rules", () => {
  const dean = {
    id: "S1",
    url: "x",
    text: "Michael M. Knetter joined the Wisconsin School of Business as its dean in July 2002. Knetter completed his undergraduate studies at the University of Wisconsin-Eau Claire. He received an honorary doctorate degree from UW-Madison in 1994.",
  };

  it("doesn't count working at the school as being an alum", () => {
    const v = verifyEnrichment(
      { ...base, uwMadisonStatus: "source_stated", uwMadisonEvidence: "joined the Wisconsin School of Business as its dean" },
      [dean],
      slugs,
    );
    expect(v.alumniStatus).toBe("unknown");
    expect(v.rejected[0]).toMatch(/doesn't say they studied there/);
  });

  it("ignores honorary degrees", () => {
    const v = verifyEnrichment(
      { ...base, educations: [{ institution: "UW–Madison", isUwMadison: true, degree: "Honorary doctorate", major: null, gradYear: 1994, evidence: "He received an honorary doctorate degree from UW-Madison in 1994", sourceId: "S1" }] },
      [dean],
      slugs,
    );
    expect(v.uwEducations).toHaveLength(0);
    expect(v.alumniStatus).toBe("unknown");
  });

  it("merges duplicate degrees", () => {
    const src = { id: "S1", url: "x", text: "She earned her MBA from the Wisconsin School of Business. MBA, Wisconsin School of Business, 2020." };
    const v = verifyEnrichment(
      {
        ...base,
        educations: [
          { institution: "WSB", isUwMadison: true, degree: "MBA", major: null, gradYear: null, evidence: "earned her MBA from the Wisconsin School of Business", sourceId: "S1" },
          { institution: "WSB", isUwMadison: true, degree: "MBA", major: null, gradYear: 2020, evidence: "MBA, Wisconsin School of Business, 2020", sourceId: "S1" },
        ],
      },
      [src],
      slugs,
    );
    expect(v.uwEducations).toEqual([expect.objectContaining({ degree: "MBA", gradYear: 2020 })]);
  });
});

describe("verifyEnrichment: mixed campuses and name collisions", () => {
  it("keeps a UW MS when the same sentence also names a UW–Milwaukee BBA", () => {
    const v = verifyEnrichment(
      {
        ...base,
        educations: [
          { institution: "University of Wisconsin", isUwMadison: true, degree: "M.S.", major: "Real Estate and Urban Land Economics", gradYear: null, evidence: "Jon earned an M.S. degree in Real Estate and Urban Land Economics from the University of Wisconsin and a BBA degree from the University Wisconsin-Milwaukee.", sourceId: "S1" },
          { institution: "UW–Milwaukee", isUwMadison: true, degree: "BBA", major: null, gradYear: null, evidence: "Jon earned an M.S. degree in Real Estate and Urban Land Economics from the University of Wisconsin and a BBA degree from the University Wisconsin-Milwaukee.", sourceId: "S1" },
        ],
      },
      [bio],
      slugs,
    );
    expect(v.uwEducations.map((e) => e.degree)).toEqual(["MS"]);
    expect(v.alumniStatus).toBe("likely");
  });

  it("drops recent-graduate degrees attached to a senior executive", () => {
    const src = { id: "S2", url: "https://example.edu/student", text: "Luke Anderson, BS Economics 2025, MS Real Estate 2026, University of Wisconsin–Madison." };
    const v = verifyEnrichment(
      {
        ...base,
        uwMadisonStatus: "source_stated",
        uwMadisonEvidence: "MS Real Estate 2026, University of Wisconsin–Madison",
        educations: [{ institution: "UW–Madison", isUwMadison: true, degree: "BS", major: "Economics", gradYear: 2025, evidence: "BS Economics 2025", sourceId: "S2" }],
      },
      [src],
      slugs,
      { seniority: "c_suite", now: new Date("2026-11-03") },
    );
    expect(v.uwEducations).toHaveLength(0);
    expect(v.alumniStatus).toBe("unknown");
    expect(v.rejected[0]).toMatch(/likely another person/);
  });
});
