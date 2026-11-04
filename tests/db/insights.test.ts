import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let member: string;
let pending: string;

interface Insights {
  total: number;
  confirmed: number;
  unconfirmed: number;
  by_market: { name: string; count: number; confirmed: number; unconfirmed: number }[];
  no_market: number;
  by_sector: { slug: string; count: number; confirmed: number; unconfirmed: number }[];
  no_sector: number;
}

const insights = (user: string, args = "") =>
  asUser(db, user, () => db.query<{ r: Insights }>(`select network_insights(${args}) as r`)).then((r) => r.rows[0].r);

beforeAll(async () => {
  db = await createTestDatabase();
  member = await createUser(db, "member@example.com", "member");
  pending = await createUser(db, "pending@example.com", "pending");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("network_insights", () => {
  it("adds up: every record is in one market (or none) and one sector (or none)", async () => {
    const r = await insights(member);
    expect(r.total).toBeGreaterThan(0);
    expect(r.confirmed + r.unconfirmed).toBe(r.total);
    expect(r.by_market.reduce((n, m) => n + m.count, 0) + r.no_market).toBe(r.total);
    expect(r.by_sector.reduce((n, s) => n + s.count, 0) + r.no_sector).toBe(r.total);
    for (const m of r.by_market) expect(m.confirmed + m.unconfirmed).toBe(m.count);
  });

  it("follows the filters", async () => {
    const place = await db.query<{ id: number }>("select id from places where name = 'Chicago'");
    const r = await insights(member, `p_industry_slugs => array['real-estate'], p_place_id => ${place.rows[0].id}`);
    expect(r.by_sector.map((s) => s.slug)).toEqual(r.total ? ["real-estate"] : []);
    expect(r.total).toBeLessThan((await insights(member)).total);
  });

  it("shows nothing to members who aren't verified", async () => {
    const r = await insights(pending);
    expect(r.total).toBe(0);
  });
});
