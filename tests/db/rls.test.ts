import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let pendingUser: string;
let memberUser: string;
let otherMember: string;
let adminUser: string;
let memberPersonId: string;
let otherPersonId: string;

async function count(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params);
  return rows[0].n;
}

beforeAll(async () => {
  db = await createTestDatabase();
  pendingUser = await createUser(db, "pending@example.com");
  memberUser = await createUser(db, "member@example.com", "member");
  otherMember = await createUser(db, "other@example.com", "member");
  adminUser = await createUser(db, "admin@example.com", "admin");

  // Give the two members a claimed profile each.
  const { rows } = await db.query<{ id: string }>(
    "select id from people where status = 'seeded' order by full_name limit 2",
  );
  memberPersonId = rows[0].id;
  otherPersonId = rows[1].id;
  await db.query("update people set claimed_by_user_id = $1, status = 'verified' where id = $2", [memberUser, memberPersonId]);
  await db.query("update people set claimed_by_user_id = $1, status = 'verified' where id = $2", [otherMember, otherPersonId]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("profiles", () => {
  it("anonymous visitors can't read profiles", async () => {
    await expect(asUser(db, null, () => db.query("select id from people limit 1"))).rejects.toThrow(/permission denied/);
  });

  it("pending (unverified) users see no profiles", async () => {
    expect(await asUser(db, pendingUser, () => count("select id from people"))).toBe(0);
  });

  it("verified members see every profile except opted-out ones", async () => {
    const visible = await asUser(db, memberUser, () => count("select id from people"));
    const notOptedOut = await count("select id from people where status <> 'opted_out'");
    expect(visible).toBe(notOptedOut);
    expect(await asUser(db, memberUser, () => count("select id from people where status = 'opted_out'"))).toBe(0);
  });

  it("members can edit allowed fields on their own profile only", async () => {
    await asUser(db, memberUser, () =>
      db.query("update people set headline = 'Updated headline' where id = $1", [memberPersonId]),
    );
    const { rows } = await db.query<{ headline: string }>("select headline from people where id = $1", [memberPersonId]);
    expect(rows[0].headline).toBe("Updated headline");

    await asUser(db, memberUser, () =>
      db.query("update people set headline = 'Hijacked' where id = $1", [otherPersonId]),
    );
    const other = await db.query<{ headline: string }>("select headline from people where id = $1", [otherPersonId]);
    expect(other.rows[0].headline).not.toBe("Hijacked");
  });

  it("members can't change server-managed fields like status", async () => {
    await expect(
      asUser(db, memberUser, () => db.query("update people set status = 'verified' where id = $1", [memberPersonId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("membership", () => {
  it("a pending user can't promote themselves", async () => {
    await expect(
      asUser(db, pendingUser, () => db.query("update members set role = 'admin' where user_id = $1", [pendingUser])),
    ).rejects.toThrow(/permission denied/);
  });

  it("members only see their own membership row; admins see all", async () => {
    expect(await asUser(db, memberUser, () => count("select user_id from members"))).toBe(1);
    expect(await asUser(db, adminUser, () => count("select user_id from members"))).toBe(4);
  });
});

describe("contact details", () => {
  it("private details never show to other members", async () => {
    const privateVisible = await asUser(db, memberUser, () =>
      count("select id from contact_points where visibility = 'private' and person_id <> $1", [memberPersonId]),
    );
    expect(privateVisible).toBe(0);
  });

  it("'members' details show to verified members but not pending users", async () => {
    expect(await asUser(db, memberUser, () => count("select id from contact_points where visibility = 'members'"))).toBeGreaterThan(0);
    expect(await asUser(db, pendingUser, () => count("select id from contact_points"))).toBe(0);
  });

  it("'connections' details show only once two people are connected", async () => {
    await db.query("delete from contact_points where person_id = $1", [otherPersonId]);
    await db.query(
      "insert into contact_points (person_id, kind, value, source, visibility) values ($1, 'phone', '+1-608-555-0199', 'self', 'connections')",
      [otherPersonId],
    );
    const sql = "select id from contact_points where person_id = $1";
    expect(await asUser(db, memberUser, () => count(sql, [otherPersonId]))).toBe(0);

    const [a, b] = [memberPersonId, otherPersonId].sort();
    await db.query("insert into edges (person_a, person_b, kind) values ($1, $2, 'met')", [a, b]);
    expect(await asUser(db, memberUser, () => count(sql, [otherPersonId]))).toBe(1);
  });

  it("members can't add details claiming a third-party source", async () => {
    await expect(
      asUser(db, memberUser, () =>
        db.query(
          "insert into contact_points (person_id, kind, value, source, visibility) values ($1, 'email', 'x@example.com', 'pdl', 'members')",
          [memberPersonId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("private CRM data", () => {
  it("notes are visible only to their author", async () => {
    await asUser(db, memberUser, () =>
      db.query("insert into notes (owner_user_id, person_id, body) values ($1, $2, 'Met at the Chicago chapter event')", [
        memberUser,
        otherPersonId,
      ]),
    );
    expect(await asUser(db, memberUser, () => count("select id from notes"))).toBe(1);
    expect(await asUser(db, otherMember, () => count("select id from notes"))).toBe(0);
    expect(await asUser(db, adminUser, () => count("select id from notes"))).toBe(0);
  });

  it("pending users can't save contacts", async () => {
    await expect(
      asUser(db, pendingUser, () =>
        db.query("insert into saved_contacts (owner_user_id, person_id) values ($1, $2)", [pendingUser, otherPersonId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("intro requests", () => {
  it("can only change through the consent functions (tests/db/introductions.test.ts)", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from people where status = 'seeded' and id not in ($1, $2) limit 1",
      [memberPersonId, otherPersonId],
    );
    // Writing a request or jumping its status directly is refused.
    await expect(
      asUser(db, memberUser, () =>
        db.query(
          "insert into intro_requests (requester_user_id, connector_person_id, target_person_id, goal) values ($1, $2, $3, 'Learn about CRE in Chicago')",
          [memberUser, otherPersonId, rows[0].id],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, otherMember, () => db.query("update intro_requests set status = 'accepted'"))).rejects.toThrow(/permission denied/);
  });
});

describe("search", () => {
  it("finds real-estate alumni near Chicago with sector and metro counts", async () => {
    const { rows: place } = await db.query<{ id: number }>("select id from places where name = 'Chicago'");
    const result = await asUser(db, memberUser, () =>
      db.query<{ full_name: string; metro: string; distance_miles: number; total_count: number }>(
        "select * from search_people(p_industry_slugs => array['real-estate'], p_place_id => $1, p_radius_miles => 40)",
        [place[0].id],
      ),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.metro).toBe("Chicago");
      expect(row.distance_miles).toBeLessThanOrEqual(40);
    }

    const facets = await asUser(db, memberUser, () =>
      db.query<{ f: { total: number; confirmed: number; unconfirmed: number; by_sector: { slug: string }[] } }>(
        "select search_facets(p_industry_slugs => array['real-estate'], p_place_id => $1, p_radius_miles => 40) as f",
        [place[0].id],
      ),
    );
    const f = facets.rows[0].f;
    expect(f.total).toBe(Number(result.rows[0].total_count));
    expect(f.confirmed + f.unconfirmed).toBe(f.total);
    expect(f.by_sector.map((s) => s.slug)).toEqual(["real-estate"]);
  });

  it("matches free text against names, titles and employers", async () => {
    const { rows } = await db.query<{ full_name: string }>("select full_name from people where status = 'seeded' limit 1");
    const result = await asUser(db, memberUser, () =>
      db.query<{ full_name: string }>("select full_name from search_people(p_text => $1)", [rows[0].full_name]),
    );
    expect(result.rows[0].full_name).toBe(rows[0].full_name);
  });

  it("returns nothing for pending users", async () => {
    const result = await asUser(db, pendingUser, () => db.query("select * from search_people()"));
    expect(result.rows).toHaveLength(0);
  });
});
