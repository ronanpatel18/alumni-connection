import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai", () => ({ getAi: () => ({}) }));
vi.mock("@/lib/people", () => ({ groupCues: async () => new Map() }));

const { tripIsOver } = await import("@/lib/trips");

const trip = (ends_on: string, state: string | null) => ({ ends_on, places: state ? { name: "City", state } : null });

describe("tripIsOver", () => {
  // 9 p.m. on 16 November in Chicago is already 17 November in UTC.
  const chicagoEvening = new Date("2026-11-17T03:00:00Z");

  it("keeps a trip that ends today upcoming in the US evening", () => {
    expect(tripIsOver(trip("2026-11-16", "WI"), chicagoEvening)).toBe(false);
    expect(tripIsOver(trip("2026-11-16", "CA"), chicagoEvening)).toBe(false);
  });

  it("calls a trip past once its last day is over where it is", () => {
    expect(tripIsOver(trip("2026-11-15", "WI"), chicagoEvening)).toBe(true);
    expect(tripIsOver(trip("2026-11-16", "NY"), new Date("2026-11-17T05:30:00Z"))).toBe(true);
  });

  it("uses Central time when the place is unknown", () => {
    expect(tripIsOver(trip("2026-11-16", null), chicagoEvening)).toBe(false);
  });
});
