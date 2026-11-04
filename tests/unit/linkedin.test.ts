import { describe, expect, it } from "vitest";
import { degreeFromDetails, isUwMadison, parseEducation, parseExperience, parseLocation } from "@/lib/enrichment/linkedin";

describe("parseExperience", () => {
  it("reads titles, employers and dates, including titles with dashes", () => {
    const snippet =
      "## Experience - Consumer Offer Manager - bp pulse at bp (Mar 2025 to present) - Customer Programs Manager at bp (Oct 2023 to Apr 2025) - Market [...] ## Skills x";
    expect(parseExperience(snippet)).toEqual([
      { title: "Consumer Offer Manager - bp pulse", organization: "bp", startDate: "2025-03-01", endDate: null, isCurrent: true },
      { title: "Customer Programs Manager", organization: "bp", startDate: "2023-10-01", endDate: "2025-04-01", isCurrent: false },
    ]);
  });

  it("returns nothing without an Experience section", () => {
    expect(parseExperience("Description: I lead teams.")).toEqual([]);
  });
});

describe("parseEducation", () => {
  it("splits schools from degree details", () => {
    expect(
      parseEducation("## Education - Harvard Business School, Master of Business Administration (MBA) - University of Wisconsin-Madison, Bachelor of Business Administration (BBA)"),
    ).toEqual([
      { school: "Harvard Business School", details: "Master of Business Administration (MBA)" },
      { school: "University of Wisconsin-Madison", details: "Bachelor of Business Administration (BBA)" },
    ]);
  });

  it("keeps a school's sub-unit with the school", () => {
    expect(parseEducation("## Education - University of Wisconsin-Madison - School of Business, BBA, Accounting - Lynbrook High School")).toEqual([
      { school: "University of Wisconsin-Madison - School of Business", details: "BBA, Accounting" },
      { school: "Lynbrook High School", details: null },
    ]);
  });

  it("tells Madison from other campuses", () => {
    expect(isUwMadison("University of Wisconsin-Madison - School of Business")).toBe(true);
    expect(isUwMadison("Wisconsin School of Business")).toBe(true);
    expect(isUwMadison("University of Wisconsin-Eau Claire")).toBe(false);
  });

  it("names the degree", () => {
    expect(degreeFromDetails("Bachelor of Business Administration (BBA), Accounting")).toEqual({ degree: "BBA", major: "Accounting" });
    expect(degreeFromDetails("Master of Accountancy, Accounting")).toEqual({ degree: "MAcc", major: "Accounting" });
  });
});

describe("parseLocation", () => {
  it("reads city and state", () => {
    expect(parseLocation("Location: Minneapolis, Minnesota, United States")).toEqual({ city: "Minneapolis", state: "MN", isMetroArea: false });
  });

  it("maps metro areas to their main city", () => {
    expect(parseLocation("Location: Greater Chicago Area United States")).toEqual({ city: "Chicago", state: "IL", isMetroArea: true });
    expect(parseLocation("Location: Dallas-Fort Worth Metroplex United States")).toEqual({ city: "Dallas", state: "TX", isMetroArea: true });
    expect(parseLocation("Location: New York City Metropolitan Area United States")).toEqual({ city: "New York", state: "NY", isMetroArea: true });
  });
});

describe("Google-style LinkedIn snippets", () => {
  const snippet =
    "Partner. PwC. Jul 2019 - Present 7 years 4 months. Brad Zastoupil is an audit partner at PwC in Minneapolis. · Director. PwC. Jul 2017 - Jun 2019 2 years. · Minneapolis, Minnesota, United States";
  it("reads jobs and location", () => {
    expect(parseExperience(snippet)).toEqual([
      { title: "Partner", organization: "PwC", startDate: "2019-07-01", endDate: null, isCurrent: true },
      { title: "Director", organization: "PwC", startDate: "2017-07-01", endDate: "2019-06-01", isCurrent: false },
    ]);
    expect(parseLocation(snippet)).toEqual({ city: "Minneapolis", state: "MN", isMetroArea: false });
  });
});
