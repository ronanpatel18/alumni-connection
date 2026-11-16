import { describe, expect, it } from "vitest";
import { formatCity, formatEducation, formatJobTitle, formatOrganization, formatSpecialties, titleCase } from "@/lib/enrichment/format";

describe("formatEducation", () => {
  it.each([
    ["BA", "computer science", "BA", "Computer Science"],
    ["bachelor of science", "computer science", "BS", "Computer Science"],
    ["Bachelor of Science in Computer Science", null, "BS", "Computer Science"],
    ["Bachelor of Business Administration (BBA)", "Finance", "BBA", "Finance"],
    ["B.B.A.", "finance and real estate", "BBA", "Finance and Real Estate"],
    ["MBA", "MBA", "MBA", null],
    ["master's degree", "REAL ESTATE AND URBAN LAND ECONOMICS", "Master’s", "Real Estate and Urban Land Economics"],
    ["Ph.D.", "a major in Economics.", "PhD", "Economics"],
    ["JD", "He studied law while working at the firm, which he later joined", "JD", null],
    [null, "accounting", null, "Accounting"],
    ["BA", "Not Stated", "BA", null],
    ["BBA", "Business Administration", "BBA", null],
    ["BS", "Business", "BS", "Business"],
  ])("%s / %s", (degree, major, d, m) => {
    expect(formatEducation(degree, major)).toEqual({ degree: d, major: m });
  });
});

describe("formatJobTitle", () => {
  it.each([
    ["lead director", "Lead Director"],
    ["ceo and co-founder", "CEO and Co-Founder"],
    ["Vice President of Worldwide Field Operations", "Vice President of Worldwide Field Operations"],
    ["SVP, m&a", "SVP, M&A"],
    ["the executive chairman.", "Executive Chairman"],
    ["MANAGING DIRECTOR", "Managing Director"],
    ["Senior Vice President- Payments", "Senior Vice President - Payments"],
    ["Co-Founder", "Co-Founder"],
    ["Head of iOS Engineering", "Head of iOS Engineering"],
    ["Managing Director Of Product & Technology", "Managing Director of Product & Technology"],
  ])("%s", (raw, formatted) => {
    expect(formatJobTitle(raw)).toBe(formatted);
  });

  it("drops what reads as a sentence", () => {
    expect(formatJobTitle("He was the CEO of the company, where he led a turnaround")).toBeNull();
    expect(formatJobTitle("leads the team that is responsible for sales")).toBeNull();
  });
});

describe("other labels", () => {
  it("keeps short keywords and drops sentences and repeats", () => {
    expect(formatSpecialties(["commercial real estate", "M&A", "Commercial Real Estate", "He focuses on helping founders raise their first round of capital", "private equity."])).toEqual([
      "Commercial Real Estate",
      "M&A",
      "Private Equity",
    ]);
  });

  it("leaves an employer's own capitals alone", () => {
    expect(formatOrganization("eBay")).toBe("eBay");
    expect(formatOrganization("PwC,")).toBe("PwC");
    expect(formatOrganization("cisco systems")).toBe("Cisco Systems");
    expect(formatOrganization("Yahoo!")).toBe("Yahoo!");
    expect(formatOrganization("IBM")).toBe("IBM");
  });

  it("title-cases cities and plain text", () => {
    expect(formatCity("new york")).toBe("New York");
    expect(formatCity("st. paul")).toBe("St. Paul");
    expect(formatCity("Headquartered in Mountain View")).toBeNull();
    expect(formatCity("Ellen Sexton - San Francisco")).toBeNull();
    expect(formatCity("Greater Chicago Area")).toBeNull();
    expect(formatCity("Silicon Valley")).toBeNull();
    expect(titleCase("the university of wisconsin")).toBe("The University of Wisconsin");
  });
});
