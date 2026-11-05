import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ai = vi.hoisted(() => ({ explainMatches: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAi: () => ai }));
vi.mock("@/lib/people", () => ({ groupCues: async () => new Map() }));
const { isActionable, nextActionFor, scoreForGoal, suggestionReasons, whyUsLine } = await import("@/lib/recommendations");

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

describe("isActionable", () => {
  it("counts members, because they can be reached here", () => {
    expect(isActionable("partners", person(), { ...signals(null), claimed_by_user_id: "u" })).toBe(true);
  });

  it("counts people who opted in to this goal, not to a different one", () => {
    expect(isActionable("mentor", person({ open_to: ["mentoring"] }), signals(null))).toBe(true);
    expect(isActionable("clients", person({ open_to: ["mentoring"] }), signals(null))).toBe(false);
  });

  it("leaves out someone with no account and no preference", () => {
    expect(isActionable("partners", person(), signals("c_suite"))).toBe(false);
  });
});

describe("nextActionFor", () => {
  it("prefers an introduction when a connector can make one", () => {
    expect(nextActionFor("p", { member: true, hasConnector: true, introOpen: false })).toEqual({
      kind: "intro",
      label: "Ask for an introduction",
      href: "/introductions/new?person=p",
    });
  });

  it("offers a message when no connector can help", () => {
    expect(nextActionFor("p", { member: true, hasConnector: false, introOpen: false })).toMatchObject({ kind: "message", href: "/messages/new?person=p" });
  });

  it("doesn't offer a second introduction while one is open", () => {
    expect(nextActionFor("p", { member: true, hasConnector: true, introOpen: true }).kind).toBe("message");
  });

  it("never offers an introduction to someone who can't accept one", () => {
    expect(nextActionFor("p", { member: false, hasConnector: true, introOpen: false })).toEqual({ kind: "save" });
  });
});

describe("whyUsLine", () => {
  it("states the shared group without implying they want to meet", () => {
    expect(whyUsLine({ name: "Graaskamp Advisory Board", kind: "advisory_board" })).toBe("You’re both on the Graaskamp Advisory Board.");
    expect(whyUsLine({ name: "Chicago Alumni Chapter", kind: "chapter" })).toBe("You’re both part of Chicago Alumni Chapter.");
  });
});

describe("suggestionReasons", () => {
  const upsert = vi.fn(async () => ({}));
  const db = { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }), upsert }) } as never;

  beforeEach(() => {
    vi.useFakeTimers();
    upsert.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops waiting for an AI host that won't answer, so the page can finish", async () => {
    ai.explainMatches.mockReturnValue(new Promise(() => {}));
    const reasons = suggestionReasons(db, "u1", "partners", null, [person()]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await reasons).toEqual(new Map());
    // Nothing is cached, so the line can still be written on a later visit.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("uses an answer that arrives in time", async () => {
    ai.explainMatches.mockResolvedValue({ matches: [{ personId: "p", why: "A clear reason." }] });
    const reasons = suggestionReasons(db, "u1", "partners", null, [person()]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await reasons).get("p")).toBe("A clear reason.");
  });
});
