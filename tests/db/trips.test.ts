import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let traveler: string;
let other: string;
let pending: string;
let tripId: string;
let personId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  traveler = await createUser(db, "traveler@example.com", "member");
  other = await createUser(db, "other@example.com", "member");
  pending = await createUser(db, "pending@example.com", "pending");
  const place = await db.query<{ id: number }>("select id from places where name = 'Chicago' limit 1");
  const trip = await asUser(db, traveler, () =>
    db.query<{ id: string }>(
      "insert into trips (owner_user_id, place_id, starts_on, ends_on, industry_slugs, goal) values ($1, $2, '2026-12-01', '2026-12-03', '{finance}', 'Meet private equity investors') returning id",
      [traveler, place.rows[0].id],
    ),
  );
  tripId = trip.rows[0].id;
  personId = (await db.query<{ id: string }>("select id from people limit 1")).rows[0].id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("trip shortlists", () => {
  it("lets the trip's owner add and remove people", async () => {
    await asUser(db, traveler, () => db.query("insert into trip_shortlist (trip_id, person_id) values ($1, $2)", [tripId, personId]));
    const { rows } = await asUser(db, traveler, () => db.query("select person_id from trip_shortlist where trip_id = $1", [tripId]));
    expect(rows).toHaveLength(1);
  });

  it("is invisible to everyone else, who also can't add to it", async () => {
    const { rows } = await asUser(db, other, () => db.query("select * from trip_shortlist where trip_id = $1", [tripId]));
    expect(rows).toHaveLength(0);
    await expect(asUser(db, other, () => db.query("insert into trip_shortlist (trip_id, person_id) values ($1, $2)", [tripId, personId]))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("goes away when the profile is removed", async () => {
    const extra = (await db.query<{ id: string }>("select id from people order by full_name desc limit 1")).rows[0].id;
    await asUser(db, traveler, () => db.query("insert into trip_shortlist (trip_id, person_id) values ($1, $2)", [tripId, extra]));
    await db.query("delete from people where id = $1", [extra]);
    const { rows } = await db.query("select 1 from trip_shortlist where person_id = $1", [extra]);
    expect(rows).toHaveLength(0);
  });
});

describe("outreach drafts", () => {
  it("keeps one private draft per recipient and trip", async () => {
    const save = (body: string) =>
      asUser(db, traveler, () =>
        db.query(
          `insert into outreach_drafts (owner_user_id, person_id, trip_id, subject, body)
           values ($1, $2, $3, 'Hello', $4)
           on conflict (owner_user_id, person_id, trip_id) do update set body = excluded.body`,
          [traveler, personId, tripId, body],
        ),
      );
    await save("First draft");
    await save("Second draft");
    const mine = await asUser(db, traveler, () => db.query<{ body: string }>("select body from outreach_drafts"));
    expect(mine.rows).toEqual([{ body: "Second draft" }]);
    const theirs = await asUser(db, other, () => db.query("select * from outreach_drafts"));
    expect(theirs.rows).toHaveLength(0);
  });

  it("can't be attached to someone else's trip, or written before verification", async () => {
    await expect(
      asUser(db, other, () =>
        db.query("insert into outreach_drafts (owner_user_id, person_id, trip_id, subject, body) values ($1, $2, $3, 'Hi', 'Hi')", [other, personId, tripId]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, pending, () =>
        db.query("insert into outreach_drafts (owner_user_id, person_id, subject, body) values ($1, $2, 'Hi', 'Hi')", [pending, personId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("recommendation cache", () => {
  it("members can store their own relevance lines, not anyone else's", async () => {
    await asUser(db, traveler, () =>
      db.query("insert into recommendations (owner_user_id, person_id, goal_hash, score, reasons) values ($1, $2, 'g1', 1, '[\"Leads PE in Chicago\"]')", [traveler, personId]),
    );
    await expect(
      asUser(db, other, () =>
        db.query("insert into recommendations (owner_user_id, person_id, goal_hash, score, reasons) values ($1, $2, 'g1', 1, '[]')", [traveler, personId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
