import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let alice: string; // sender, has a profile
let bob: string; // recipient, has a profile
let eve: string; // outsider
let pending: string;
let bobPerson: string;
let unclaimed: string;

const start = (user: string, person: string, body = "Hello from a fellow Badger.") =>
  asUser(db, user, () => db.query<{ id: string }>("select start_conversation($1, 'Hello', $2) as id", [person, body])).then((r) => r.rows[0].id);

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createUser(db, "alice@example.com", "member");
  bob = await createUser(db, "bob@example.com", "member");
  eve = await createUser(db, "eve@example.com", "member");
  pending = await createUser(db, "pending@example.com", "pending");
  const people = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null order by full_name limit 3")).rows.map((r) => r.id);
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [alice, people[0]]);
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [bob, people[1]]);
  bobPerson = people[1];
  unclaimed = people[2];
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("conversations", () => {
  let id: string;

  it("lets a member message another member, and notifies them", async () => {
    id = await start(alice, bobPerson);
    const notes = await asUser(db, bob, () => db.query<{ kind: string; link: string }>("select kind, link from notifications"));
    expect(notes.rows).toEqual([{ kind: "message", link: `/messages/${id}` }]);
  });

  it("can't reach people who haven't joined, or be used before verification", async () => {
    await expect(start(alice, unclaimed)).rejects.toThrow(/hasn't joined/);
    await expect(start(pending, bobPerson)).rejects.toThrow(/Verified members only/);
  });

  it("is visible only to the two people in it", async () => {
    const seen = await asUser(db, eve, () => db.query("select * from messages where conversation_id = $1", [id]));
    expect(seen.rows).toHaveLength(0);
    await expect(asUser(db, eve, () => db.query("select send_message($1, 'hi')", [id]))).rejects.toThrow(/isn't yours/);
    await expect(asUser(db, alice, () => db.query("insert into messages (conversation_id, sender_user_id, body) values ($1, $2, 'x')", [id, alice]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("keeps one conversation per pair, tracks unread, and doesn't pile up notifications", async () => {
    const again = await start(alice, bobPerson, "A second note.");
    expect(again).toBe(id);
    const list = await asUser(db, bob, () => db.query<{ unread: boolean; other_name: string }>("select * from my_conversations()"));
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].unread).toBe(true);
    const notes = await asUser(db, bob, () => db.query("select 1 from notifications where kind = 'message'"));
    expect(notes.rows).toHaveLength(1);

    await asUser(db, bob, () => db.query("select mark_conversation_read($1)", [id]));
    const after = await asUser(db, bob, () => db.query<{ unread: boolean }>("select unread from my_conversations()"));
    expect(after.rows[0].unread).toBe(false);

    await asUser(db, bob, () => db.query("select send_message($1, 'Thanks, happy to chat.')", [id]));
    const forAlice = await asUser(db, alice, () => db.query<{ unread: boolean }>("select unread from my_conversations()"));
    expect(forAlice.rows[0].unread).toBe(true);
  });

  it("limits how many new conversations a member can start in a day", async () => {
    const others = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null order by full_name desc limit 21")).rows;
    for (const [i, p] of others.entries()) {
      const user = await createUser(db, `member${i}@example.com`, "member");
      await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [user, p.id]);
    }
    const tries = others.map((p) => start(eve, p.id).then(() => "ok", (e: Error) => e.message));
    const results = [];
    for (const t of tries) results.push(await t);
    expect(results.filter((r) => r === "ok")).toHaveLength(20);
    expect(results.at(-1)).toMatch(/20 conversations today/);
  });
});

describe("introduction notifications", () => {
  it("tell whoever decides next", async () => {
    const connector = await createUser(db, "connector@example.com", "member");
    const target = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null limit 1")).rows[0].id;
    const connectorPerson = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null and id <> $1 limit 1", [target])).rows[0].id;
    await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [connector, connectorPerson]);
    const { rows } = await db.query<{ id: string }>(
      "insert into intro_requests (requester_user_id, connector_person_id, target_person_id, goal) values ($1, $2, $3, 'A good reason to meet them') returning id",
      [alice, connectorPerson, target],
    );
    await db.query("insert into intro_events (intro_id, actor_user_id, role, action) values ($1, $2, 'requester', 'requested')", [rows[0].id, alice]);
    const notes = await asUser(db, connector, () => db.query<{ kind: string; title: string }>("select kind, title from notifications"));
    expect(notes.rows).toEqual([expect.objectContaining({ kind: "intro_request" })]);
    expect(notes.rows[0].title).toMatch(/asked you to introduce them/);
  });
});
