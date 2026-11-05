import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let admin: string;
let member: string;
let people: string[];

interface Metrics {
  invited: number;
  claimed: number;
  in_review: number;
  waiting: number;
  expired: number;
  removed: number | null;
  members: number;
  with_preferences: number;
  reachable_by_intro: number;
}

const metrics = (group: string | null = null) =>
  asUser(db, admin, () => db.query<{ m: Metrics }>("select admin_pilot_metrics($1) as m", [group])).then((r) => r.rows[0].m);

let tokens = 0;
const link = (person: string | null, extra = "") =>
  db.query(`insert into profile_links (person_id, token_sha256${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2${extra ? ", " + extra.split("=")[1] : ""})`, [person, `token-${tokens++}`]);

async function claim(person: string, email: string, openTo = "{}") {
  const user = await createUser(db, email, "member");
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed', open_to = $3 where id = $2", [user, person, openTo]);
  await db.query("update members set person_id = $1 where user_id = $2", [person, user]);
  return user;
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin@example.com", "admin");
  member = await createUser(db, "member@example.com", "member");
  people = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null order by full_name limit 6")).rows.map((r) => r.id);
  await db.query("delete from group_memberships");
  const group = await db.query<{ id: string }>("insert into groups (institution_id, slug, name, kind) select id, 'pilot-board', 'Pilot Board', 'advisory_board' from institutions limit 1 returning id");
  for (const person of people.slice(0, 3)) await db.query("insert into group_memberships (group_id, person_id) values ($1, $2)", [group.rows[0].id, person]);

  // Two claimed on the same board, one with a second expired link; one waiting.
  const [a, b, c, d, e] = people;
  await link(a, "claimed_at=now()");
  await link(a, "expires_at=now() - interval '1 day'");
  await link(b, "claimed_at=now()");
  await claim(a, "a@example.com", "{networking}");
  const claimantB = await claim(b, "b@example.com");
  await link(c);
  await link(d, "expires_at=now() - interval '1 day'");
  // One waiting on a manual check.
  await link(e);
  await db.query("insert into claim_requests (person_id, user_id, method) values ($1, $2, 'manual')", [e, claimantB]);
  // One person who removed themselves, with two links.
  const removedAt = "2026-11-01T00:00:00Z";
  await link(null, `removed_at='${removedAt}'`);
  await link(null, `removed_at='${removedAt}'`);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_pilot_metrics", () => {
  it("counts each person once through the funnel", async () => {
    expect(await metrics()).toMatchObject({ invited: 6, claimed: 2, in_review: 1, waiting: 1, expired: 1, removed: 1 });
  });

  it("counts members, stated preferences, and who a connector could reach", async () => {
    expect(await metrics()).toMatchObject({ members: 2, with_preferences: 1, reachable_by_intro: 2 });
  });

  it("doesn't count a lone member as reachable by introduction", async () => {
    await claim(people[5], "lone@example.com");
    expect(await metrics()).toMatchObject({ members: 3, reachable_by_intro: 2 });
  });

  it("limits to one cohort, and leaves removals unknown there", async () => {
    expect(await metrics("pilot-board")).toMatchObject({ invited: 3, claimed: 2, waiting: 1, expired: 0, in_review: 0, removed: null, members: 2 });
  });

  it("is for administrators only", async () => {
    await expect(asUser(db, member, () => db.query("select admin_pilot_metrics()"))).rejects.toThrow(/Administrators only/);
    await expect(asUser(db, null, () => db.query("select admin_pilot_metrics()"))).rejects.toThrow(/permission denied/);
  });
});
