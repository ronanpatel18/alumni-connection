import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let requester: string;
let connectorUser: string;
let recipientUser: string;
let stranger: string;
let connector: string; // person ids
let recipient: string;
let other: string;

const GOAL = "I'd value a conversation about commercial real estate in Chicago.";

async function claim(userId: string, personId: string) {
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [userId, personId]);
  await db.query("update members set person_id = $2 where user_id = $1", [userId, personId]);
}

const request = (target = recipient, via = connector, goal = GOAL) =>
  asUser(db, requester, () => db.query<{ id: string }>("select request_intro($1, $2, $3, null) as id", [target, via, goal])).then((r) => r.rows[0].id);

const status = async (id: string) => (await db.query<{ status: string }>("select status from intro_requests where id = $1", [id])).rows[0].status;

beforeAll(async () => {
  db = await createTestDatabase();
  requester = await createUser(db, "requester@example.com", "member");
  connectorUser = await createUser(db, "connector@example.com", "member");
  recipientUser = await createUser(db, "recipient@example.com", "member");
  stranger = await createUser(db, "stranger@example.com", "member");
  const people = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null order by full_name limit 3")).rows;
  [connector, recipient, other] = people.map((p) => p.id);
  await claim(connectorUser, connector);
  await claim(recipientUser, recipient);
  // The connector and the recipient serve on the same board.
  const group = await db.query<{ id: string }>("insert into groups (institution_id, slug, name, kind) select id, 'test-board', 'Test Advisory Board', 'advisory_board' from institutions limit 1 returning id");
  await db.query("insert into group_memberships (group_id, person_id) values ($1, $2), ($1, $3)", [group.rows[0].id, connector, recipient]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("finding a connector", () => {
  it("lists members who share a group with the recipient", async () => {
    const { rows } = await asUser(db, requester, () => db.query<{ person_id: string; shared: string }>("select * from intro_connectors($1)", [recipient]));
    expect(rows).toEqual([expect.objectContaining({ person_id: connector, shared: "Test Advisory Board" })]);
  });

  it("rejects connectors who don't know the recipient, and thin requests", async () => {
    await expect(request(recipient, other)).rejects.toThrow(/can't introduce you/);
    await expect(request(recipient, connector, "Hi")).rejects.toThrow(/more context/);
  });
});

describe("double opt-in", () => {
  let id: string;

  it("keeps the recipient out of it until the connector agrees", async () => {
    id = await request();
    expect(await status(id)).toBe("pending_connector");
    const seen = await asUser(db, recipientUser, () => db.query("select * from intro_request_details($1)", [id]));
    expect(seen.rows).toHaveLength(0);
    const direct = await asUser(db, recipientUser, () => db.query("select * from intro_requests where id = $1", [id]));
    expect(direct.rows).toHaveLength(0);
  });

  it("only lets each party make their own decision", async () => {
    await expect(asUser(db, requester, () => db.query("select decide_intro_as_connector($1, true)", [id]))).rejects.toThrow(/isn't yours/);
    await expect(asUser(db, recipientUser, () => db.query("select decide_intro_as_recipient($1, true)", [id]))).rejects.toThrow(/isn't yours/);
    await expect(asUser(db, stranger, () => db.query("select decide_intro_as_connector($1, true)", [id]))).rejects.toThrow(/isn't yours/);
    await expect(asUser(db, requester, () => db.query("update intro_requests set status = 'accepted' where id = $1", [id]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("completes only after both yeses, recording each decision", async () => {
    await asUser(db, connectorUser, () => db.query("select decide_intro_as_connector($1, true)", [id]));
    expect(await status(id)).toBe("pending_target");
    const seen = await asUser(db, recipientUser, () => db.query<{ my_role: string; requester_name: string }>("select * from intro_request_details($1)", [id]));
    expect(seen.rows[0]).toMatchObject({ my_role: "recipient", requester_name: "requester" });

    await asUser(db, recipientUser, () => db.query("select decide_intro_as_recipient($1, true)", [id]));
    expect(await status(id)).toBe("accepted");

    const events = await asUser(db, requester, () => db.query<{ role: string; action: string }>("select role, action from intro_events where intro_id = $1 order by id", [id]));
    expect(events.rows).toEqual([
      { role: "requester", action: "requested" },
      { role: "connector", action: "agreed" },
      { role: "recipient", action: "accepted" },
    ]);
    const logged = await db.query("select 1 from interactions where owner_user_id = $1 and person_id = $2 and kind = 'intro'", [requester, recipient]);
    expect(logged.rows).toHaveLength(1);
  });

  it("keeps consent events append-only", async () => {
    await expect(asUser(db, requester, () => db.query("delete from intro_events where intro_id = $1", [id]))).rejects.toThrow(/permission denied/);
  });
});

describe("closing a request", () => {
  it("a quiet decline from the connector ends it", async () => {
    const id = await request();
    await asUser(db, connectorUser, () => db.query("select decide_intro_as_connector($1, false)", [id]));
    expect(await status(id)).toBe("declined");
  });

  it("the requester can cancel, and only one request per recipient is open at a time", async () => {
    const id = await request();
    await expect(request()).rejects.toThrow(/already have an open/);
    await asUser(db, requester, () => db.query("select cancel_intro($1)", [id]));
    expect(await status(id)).toBe("cancelled");
  });

  it("expires after 30 days", async () => {
    const id = await request();
    await db.query("update intro_requests set expires_at = now() - interval '1 day' where id = $1", [id]);
    const result = await asUser(db, connectorUser, () => db.query<{ r: string }>("select decide_intro_as_connector($1, true) as r", [id]));
    expect(result.rows[0].r).toBe("expired");
    expect(await status(id)).toBe("expired");
  });
});

describe("recording a meeting", () => {
  let id: string;
  const record = (user: string | null, intro = id) => asUser(db, user, () => db.query<{ r: string }>("select record_intro_meeting($1) as r", [intro])).then((r) => r.rows[0].r);
  const metCount = async () => (await db.query("select 1 from intro_events where intro_id = $1 and action = 'met'", [id])).rows.length;

  beforeAll(async () => {
    id = await request();
    await asUser(db, connectorUser, () => db.query("select decide_intro_as_connector($1, true)", [id]));
  });

  it("isn't possible until both have agreed", async () => {
    await expect(record(requester)).rejects.toThrow(/completed introduction/);
    await asUser(db, recipientUser, () => db.query("select decide_intro_as_recipient($1, true)", [id]));
  });

  it("belongs only to the two people introduced", async () => {
    await expect(record(connectorUser)).rejects.toThrow(/isn't yours/);
    await expect(record(stranger)).rejects.toThrow(/isn't yours/);
    await expect(record(null)).rejects.toThrow(/permission denied/);
    expect(await metCount()).toBe(0);
  });

  it("records once per person, and adds it to the requester's relationship history", async () => {
    expect(await record(requester)).toBe("recorded");
    expect(await record(requester)).toBe("already_recorded");
    expect(await metCount()).toBe(1);
    const logged = await db.query("select 1 from interactions where owner_user_id = $1 and person_id = $2 and kind = 'meeting'", [requester, recipient]);
    expect(logged.rows).toHaveLength(1);
  });

  it("lets the recipient record it too, without notifying anyone", async () => {
    const before = await db.query("select 1 from notifications");
    expect(await record(recipientUser)).toBe("recorded");
    expect(await metCount()).toBe(2);
    expect((await db.query("select 1 from notifications")).rows.length).toBe(before.rows.length);
  });
});

describe("admin_intro_metrics", () => {
  let admin: string;
  interface Metrics {
    requested: number;
    awaiting_connector: number;
    awaiting_recipient: number;
    accepted: number;
    declined: number;
    closed: number;
    met: number;
  }
  const metrics = (group: string | null = null) => asUser(db, admin, () => db.query<{ m: Metrics }>("select admin_intro_metrics($1) as m", [group])).then((r) => r.rows[0].m);

  beforeAll(async () => {
    admin = await createUser(db, "admin@example.com", "admin");
  });

  it("counts each stage, and each met introduction once though both recorded it", async () => {
    const before = await metrics();
    expect(before.met).toBe(1);
    expect(before.requested).toBe(before.awaiting_connector + before.awaiting_recipient + before.accepted + before.declined + before.closed);
    expect(before.accepted).toBeGreaterThan(0);
  });

  it("treats a request past its date as closed, even before anyone opens it", async () => {
    const before = await metrics();
    const id = await request();
    await db.query("update intro_requests set expires_at = now() - interval '1 day' where id = $1", [id]);
    const after = await metrics();
    expect(after.closed).toBe(before.closed + 1);
    expect(after.awaiting_connector).toBe(before.awaiting_connector);
    await db.query("update intro_requests set status = 'expired' where id = $1", [id]);
  });

  it("limits to introductions to one group", async () => {
    expect((await metrics("test-board")).requested).toBeGreaterThan(0);
    expect((await metrics("no-such-group")).requested).toBe(0);
  });

  it("is for administrators only", async () => {
    await expect(asUser(db, requester, () => db.query("select admin_intro_metrics()"))).rejects.toThrow(/Administrators only/);
    await expect(asUser(db, null, () => db.query("select admin_intro_metrics()"))).rejects.toThrow(/permission denied/);
  });
});
