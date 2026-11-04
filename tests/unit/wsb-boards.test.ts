import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupFor, isSuppressed, normalizeSnapshot, seniorityFor, snapshotSchema, splitName } from "@/lib/importers/wsb-boards";

const snapshot = snapshotSchema.parse(JSON.parse(readFileSync("data/sources/wsb-advisory-boards-2026-11-03.json", "utf8")));
const members = normalizeSnapshot(snapshot);

describe("WSB advisory board import", () => {
  it("parses all 66 living members with unique external ids", () => {
    expect(members).toHaveLength(66);
    expect(new Set(members.map((m) => m.externalId)).size).toBe(66);
  });

  it("maps boards to stable group slugs, including cross-listed center boards", () => {
    expect(groupFor("WSB External Advisory Board").slug).toBe("wsb-external-advisory-board");
    expect(groupFor("Nicholas Advisory Board").slug).toBe("wsb-nicholas-advisory-board");
    const rudikoff = members.find((m) => m.fullName === "Alan Rudikoff")!;
    expect(rudikoff.groups.map((g) => g.slug).sort()).toEqual(["wsb-external-advisory-board", "wsb-graaskamp-sustaining-advisory-board"]);
  });

  it("splits names with initials and suffixes", () => {
    expect(splitName("H. Signe Ostby")).toEqual({ firstName: "Signe", lastName: "Ostby" });
    expect(splitName("Jon D. Hammes")).toEqual({ firstName: "Jon", lastName: "Hammes" });
  });

  it("derives seniority from titles", () => {
    expect(seniorityFor("Co-CEO and Co-Portfolio Manager")).toBe("c_suite");
    expect(seniorityFor("Managing Vice President, Customer Group Strategy")).toBe("vp");
    expect(seniorityFor("Founder & Managing Partner")).toBe("owner");
    expect(seniorityFor("Senior Project Controller")).toBe("manager");
    expect(seniorityFor("Analyst")).toBe("mid");
  });

  it("treats 'Self-Employed' as no employer and marks alumni-board members as likely alumni", () => {
    const toney = members.find((m) => m.fullName === "Stephanie Toney")!;
    expect(toney.organizationName).toBeNull();
    expect(toney.alumniStatus).toBe("likely");
    expect(toney.externalId).toBe("alumni-board/stephanie-toney");
  });
});

describe("isSuppressed", () => {
  const hammes = members.find((m) => m.fullName === "Patrick Hammes")!;

  it("matches a removal by the listing's own ID", () => {
    expect(isSuppressed(hammes, [{ full_name: "Patrick Hammes", source: "wsb-advisory-boards", external_id: hammes.externalId }])).toBe(true);
  });

  it("doesn't block a different person who shares the name", () => {
    expect(isSuppressed(hammes, [{ full_name: "Patrick Hammes", source: "wsb-advisory-boards", external_id: "someone-else" }])).toBe(false);
  });

  it("falls back to the name for requests without a source ID", () => {
    expect(isSuppressed(hammes, [{ full_name: "patrick hammes ", source: null, external_id: null }])).toBe(true);
  });
});

describe("seniorityFor", () => {
  it("judges the role by the title's first clause", () => {
    expect(seniorityFor("Associate, COO Office of Technology & Innovations")).toBe("mid");
    expect(seniorityFor("Managing Director, West Coast")).toBe("partner");
    expect(seniorityFor("SVP & CFO")).toBe("c_suite");
    expect(seniorityFor("Founder and CIO")).toBe("owner");
  });
});
