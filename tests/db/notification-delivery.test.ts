import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let user: string;

const claim = (limit = 25) => db.query<{ id: number; attempts: number }>("select * from claim_notifications($1)", [limit]).then((r) => r.rows);
const add = (columns = "", values = "") =>
  db
    .query<{ id: number }>(`insert into notifications (user_id, kind, title, link${columns}) values ($1, 'message', 'A notice', '/messages'${values}) returning id`, [user])
    .then((r) => r.rows[0].id);

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
  user = await createUser(db, "member@example.com", "member");
}, 120_000);

beforeEach(async () => {
  await db.query("delete from notifications");
});

afterAll(async () => {
  await db?.close();
});

describe("claim_notifications", () => {
  it("hands a row to one run only, and counts the attempt", async () => {
    const id = await add();
    expect(await claim()).toEqual([expect.objectContaining({ id, attempts: 1 })]);
    expect(await claim()).toEqual([]);
  });

  it("takes the oldest first, up to the limit", async () => {
    const first = await add(", created_at", ", now() - interval '1 hour'");
    await add();
    expect((await claim(1)).map((r) => r.id)).toEqual([first]);
  });

  it("offers a row again once a dead run's lease expires", async () => {
    const id = await add(", claimed_until, attempts", ", now() - interval '1 minute', 1");
    expect(await claim()).toEqual([expect.objectContaining({ id, attempts: 2 })]);
  });

  it("skips rows that are sent, failed, or waiting for a retry", async () => {
    await add(", emailed_at", ", now()");
    await add(", failed_at", ", now()");
    await add(", next_attempt_at", ", now() + interval '5 minutes'");
    expect(await claim()).toEqual([]);
  });

  it("gives up on a row whose runs keep dying, without blocking the next", async () => {
    const stuck = await add(", attempts, claimed_until", ", 5, now() - interval '1 minute'");
    const next = await add();
    expect((await claim()).map((r) => r.id)).toEqual([next]);
    const { rows } = await db.query<{ failed: boolean }>("select failed_at is not null as failed from notifications where id = $1", [stuck]);
    expect(rows[0].failed).toBe(true);
  });

  it("isn't open to members or visitors", async () => {
    await expect(asUser(db, user, () => db.query("select * from claim_notifications()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, () => db.query("select * from claim_notifications()"))).rejects.toThrow(/permission denied/);
  });
});
