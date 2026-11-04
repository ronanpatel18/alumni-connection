import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { scoreForGoal } = await import("@/lib/recommendations");

const person = (over: Record<string, unknown> = {}) =>
  ({
    id: "p",
    full_name: "Pat Example",
    current_title: null,
    organization_name: null,
    city: "Chicago",
    state: "IL",
    status: "seeded",
    open_to: [],
    grad_year: null,
    degree: null,
    ...over,
  }) as never;
const signals = (seniority: string | null, slug = "consulting", parent: string | null = null, starts: string[] = []) => ({
  id: "p",
  seniority,
  industries: { slug, parent: parent ? { slug: parent } : null },
  positions: starts.map((start_date) => ({ start_date })),
});

describe("scoreForGoal", () => {
  it("puts investors first for the investors goal", () => {
    const vc = scoreForGoal("investors", person(), signals("partner", "venture-capital", "finance"), null);
    const auditor = scoreForGoal("investors", person(), signals("partner", "audit", "accounting"), null);
    expect(vc).toBeGreaterThan(auditor);
  });

  it("favors people who said they're open to mentoring, then long careers", () => {
    const open = scoreForGoal("mentor", person({ open_to: ["mentoring"] }), signals("manager"), null);
    const veteran = scoreForGoal("mentor", person(), signals("director", "consulting", null, ["1995-01-01"]), null);
    const newcomer = scoreForGoal("mentor", person(), signals("mid", "consulting", null, ["2024-01-01"]), null);
    expect(open).toBeGreaterThan(newcomer);
    expect(veteran).toBeGreaterThan(newcomer);
  });

  it("rewards the member's own sector for partnerships", () => {
    const same = scoreForGoal("partners", person(), signals("director", "private-equity", "finance"), "finance");
    const other = scoreForGoal("partners", person(), signals("director", "software", "technology"), "finance");
    expect(same).toBeGreaterThan(other);
  });
});
