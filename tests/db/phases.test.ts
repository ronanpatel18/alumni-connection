// Follow-ups, meetings, introduction paths, events, jobs, businesses,
// mentorship and the engagement numbers (migrations 20261112…).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let alice: string;
let bob: string;
let eve: string;
let admin: string;
let pending: string;
let alicePerson: string;
let bobPerson: string;
let unclaimed: string;

const as = <T>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => db.query<T>(sql, params)).then((r) => r.rows);
const soon = "now() + interval '3 days'";

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createUser(db, "alice@example.com", "member");
  bob = await createUser(db, "bob@example.com", "member");
  eve = await createUser(db, "eve@example.com", "member");
  admin = await createUser(db, "admin@example.com", "admin");
  pending = await createUser(db, "pending@example.com", "pending");
  const people = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null order by full_name limit 3")).rows.map((r) => r.id);
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [alice, people[0]]);
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed', open_to = '{mentoring}' where id = $2", [bob, people[1]]);
  [alicePerson, bobPerson, unclaimed] = people;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("follow-ups", () => {
  it("are private, and remind their author once when due", async () => {
    await as(alice, "insert into interactions (owner_user_id, person_id, kind, summary, follow_up_at) values ($1, $2, 'call', 'Talked about Chicago', now() - interval '1 hour')", [alice, bobPerson]);
    await as(alice, "insert into interactions (owner_user_id, person_id, kind, follow_up_at) values ($1, $2, 'meeting', now() + interval '5 days')", [alice, unclaimed]);
    expect(await as(bob, "select id from interactions")).toHaveLength(0);

    expect((await db.query<{ n: number }>("select queue_follow_up_reminders() as n")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select queue_follow_up_reminders() as n")).rows[0].n).toBe(0);
    const notes = await as<{ kind: string; link: string }>(alice, "select kind, link from notifications where kind = 'follow_up'");
    expect(notes).toEqual([{ kind: "follow_up", link: "/followups" }]);
    await expect(as(alice, "select queue_follow_up_reminders()")).rejects.toThrow(/permission denied/);
  });
});

describe("meetings", () => {
  let id: string;

  it("lets a member propose a time to another member, who is notified", async () => {
    [{ id }] = await as<{ id: string }>(alice, `select propose_meeting($1, 'Coffee', ${soon}, 30, 'Memorial Union') as id`, [bobPerson]);
    expect(await as(bob, "select title from notifications where kind = 'meeting'")).toHaveLength(1);
    expect(await as(eve, "select id from meetings")).toHaveLength(0);
  });

  it("refuses people who haven't joined, past times and unverified users", async () => {
    await expect(as(alice, `select propose_meeting($1, 'Coffee', ${soon}, 30)`, [unclaimed])).rejects.toThrow(/hasn't joined/);
    await expect(as(alice, "select propose_meeting($1, 'Coffee', now() - interval '1 day', 30)", [bobPerson])).rejects.toThrow(/future/);
    await expect(as(pending, `select propose_meeting($1, 'Coffee', ${soon}, 30)`, [bobPerson])).rejects.toThrow(/Verified members only/);
  });

  it("is booked only when the invited person accepts", async () => {
    await expect(as(alice, "select respond_to_meeting($1, true)", [id])).rejects.toThrow(/isn't yours to answer/);
    await expect(as(eve, "select respond_to_meeting($1, true)", [id])).rejects.toThrow(/isn't yours to answer/);
    await as(bob, "select respond_to_meeting($1, true)", [id]);
    const mine = await as<{ status: string; i_proposed: boolean; other_person_id: string }>(alice, "select status, i_proposed, other_person_id from my_meetings()");
    expect(mine).toEqual([{ status: "accepted", i_proposed: true, other_person_id: bobPerson }]);
    await expect(as(bob, "select respond_to_meeting($1, false)", [id])).rejects.toThrow(/already answered/);
    await expect(as(alice, "update meetings set status = 'declined' where id = $1", [id])).rejects.toThrow(/permission denied/);
  });

  it("can be cancelled by either person, not by anyone else", async () => {
    await expect(as(eve, "select cancel_meeting($1)", [id])).rejects.toThrow(/isn't yours/);
    await as(bob, "select cancel_meeting($1)", [id]);
    expect((await as<{ status: string }>(alice, "select status from my_meetings()"))[0].status).toBe("cancelled");
  });
});

describe("introduction paths", () => {
  it("offers a former colleague of the recipient as a connector", async () => {
    await db.query("insert into positions (person_id, organization_name, title) values ($1, 'Badger Capital', 'Analyst'), ($2, 'badger capital', 'Partner')", [bobPerson, unclaimed]);
    const found = await as<{ person_id: string; shared: string }>(alice, "select person_id, shared from intro_connectors($1)", [unclaimed]);
    expect(found.find((c) => c.person_id === bobPerson)?.shared).toContain("Worked at");
  });

  it("uses an imported connection only after its owner agrees to share", async () => {
    const target = (await db.query<{ id: string }>("select id from people where claimed_by_user_id is null and id <> $1 order by full_name desc limit 1", [unclaimed])).rows[0].id;
    await as(eve, "select 1"); // eve has no profile: she can't be a connector either way
    await as(bob, "insert into my_connections (owner_user_id, person_id, matched_by) values ($1, $2, 'profile_url')", [bob, target]);
    const before = await as<{ person_id: string }>(alice, "select person_id from intro_connectors($1)", [target]);
    expect(before.map((c) => c.person_id)).not.toContain(bobPerson);
    await as(bob, "select set_share_connections(true)");
    const after = await as<{ person_id: string; shared: string }>(alice, "select person_id, shared from intro_connectors($1)", [target]);
    expect(after.find((c) => c.person_id === bobPerson)?.shared).toContain("Connected on LinkedIn");
    await expect(as(bob, "update members set share_connections = false where user_id = $1", [bob])).rejects.toThrow(/permission denied/);
  });
});

describe("events", () => {
  let id: string;

  it("lets members post events and RSVP; others see who's going", async () => {
    const institution = (await db.query<{ id: string }>("select id from institutions limit 1")).rows[0].id;
    const place = (await db.query<{ id: number; name: string }>("select id, name from places order by id limit 1")).rows[0];
    [{ id }] = await as<{ id: string }>(alice, `insert into events (institution_id, created_by, title, starts_at, place_id) values ($1, $2, 'Badger game watch', ${soon}, $3) returning id`, [institution, alice, place.id]);
    await as(bob, "insert into event_rsvps (event_id, user_id) values ($1, $2)", [id, bob]);
    const list = await as<{ city: string; going: number; i_am_going: boolean; is_mine: boolean }>(eve, "select city, going, i_am_going, is_mine from event_list()");
    expect(list).toEqual([{ city: place.name, going: 1, i_am_going: false, is_mine: false }]);
    expect(await as(pending, "select id from events")).toHaveLength(0);
    await expect(as(pending, `insert into events (institution_id, created_by, title, starts_at) values ($1, $2, 'x', ${soon})`, [institution, pending])).rejects.toThrow(/row-level security/);
    await expect(as(eve, "insert into event_rsvps (event_id, user_id) values ($1, $2)", [id, bob])).rejects.toThrow(/row-level security/);
  });

  it("can be changed only by its host or an administrator", async () => {
    await as(eve, "update events set title = 'Hijacked' where id = $1", [id]);
    expect((await db.query<{ title: string }>("select title from events where id = $1", [id])).rows[0].title).toBe("Badger game watch");
    await as(admin, "update events set cancelled_at = now() where id = $1", [id]);
    expect((await as<{ cancelled: boolean }>(alice, "select cancelled from event_list()"))[0].cancelled).toBe(true);
  });

  it("gives each member a private calendar address they can replace", async () => {
    const [{ token }] = await as<{ token: string }>(alice, "select rotate_calendar_feed() as token");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await as(bob, "select token from calendar_feeds")).toHaveLength(0);
    const [{ token: next }] = await as<{ token: string }>(alice, "select rotate_calendar_feed() as token");
    expect(next).not.toBe(token);
    expect(await as(alice, "select token from calendar_feeds")).toEqual([{ token: next }]);
  });
});

describe("jobs and businesses", () => {
  it("shows open jobs to members, with the poster for a referral", async () => {
    await as(bob, "insert into job_posts (posted_by, title, organization_name, can_refer) values ($1, 'Analyst', 'Badger Capital', true)", [bob]);
    await as(bob, "insert into job_posts (posted_by, title, organization_name, expires_on) values ($1, 'Old role', 'Badger Capital', current_date - 1)", [bob]);
    const seen = await as<{ title: string; poster_person_id: string; can_refer: boolean }>(alice, "select title, poster_person_id, can_refer from job_board()");
    expect(seen).toEqual([{ title: "Analyst", poster_person_id: bobPerson, can_refer: true }]);
    expect(await as(bob, "select title from job_board()")).toHaveLength(2); // the poster still sees their expired one
    expect(await as(pending, "select title from job_board()")).toHaveLength(0);
    await as(alice, "delete from job_posts");
    expect((await db.query("select 1 from job_posts")).rows).toHaveLength(2);
  });

  it("lets a member list a business that only they or an administrator can change", async () => {
    await as(alice, "insert into business_listings (owner_user_id, name, category, website) values ($1, 'Alice''s Bakery', 'Food and drink', 'https://example.com')", [alice]);
    await expect(as(alice, "insert into business_listings (owner_user_id, name, category, website) values ($1, 'Bad', 'x', 'javascript:alert(1)')", [alice])).rejects.toThrow(/check constraint/);
    await as(bob, "update business_listings set name = 'Bob''s now'");
    const seen = await as<{ name: string; owner_person_id: string; is_mine: boolean }>(bob, "select name, owner_person_id, is_mine from business_directory()");
    expect(seen).toEqual([{ name: "Alice's Bakery", owner_person_id: alicePerson, is_mine: false }]);
  });
});

describe("mentorship", () => {
  let id: string;

  it("lets a member with a profile ask someone who is open to mentoring", async () => {
    await expect(as(eve, "select request_mentorship($1, 'Career advice')", [bobPerson])).rejects.toThrow(/Set up your own profile/);
    await expect(as(bob, "select request_mentorship($1, 'Career advice')", [alicePerson])).rejects.toThrow(/isn't taking mentees/);
    [{ id }] = await as<{ id: string }>(alice, "select request_mentorship($1, 'Moving into private equity') as id", [bobPerson]);
    await expect(as(alice, "select request_mentorship($1, 'Again')", [bobPerson])).rejects.toThrow(/already asked/);
    expect(await as(bob, "select 1 from notifications where kind = 'mentorship'")).toHaveLength(1);
    expect(await as(eve, "select id from mentorships")).toHaveLength(0);
  });

  it("connects the two only when the mentor agrees, and disconnects them when it ends", async () => {
    await expect(as(alice, "select respond_to_mentorship($1, true)", [id])).rejects.toThrow(/isn't yours to answer/);
    await as(bob, "select respond_to_mentorship($1, true)", [id]);
    expect((await db.query("select 1 from edges where kind = 'mentor'")).rows).toHaveLength(1);
    const [mine] = await as<{ status: string; i_am_mentor: boolean; other_person_id: string }>(bob, "select status, i_am_mentor, other_person_id from my_mentorships()");
    expect(mine).toEqual({ status: "accepted", i_am_mentor: true, other_person_id: alicePerson });
    await as(alice, "select end_mentorship($1)", [id]);
    expect((await db.query("select 1 from edges where kind = 'mentor'")).rows).toHaveLength(0);
  });
});

describe("engagement numbers", () => {
  it("are for administrators only and count activity without naming anyone", async () => {
    await expect(as(alice, "select admin_engagement_metrics()")).rejects.toThrow(/Administrators only/);
    const [{ m }] = await as<{ m: { members: number; active_30d: number; last_30d: Record<string, number>; weekly: unknown[] } }>(admin, "select admin_engagement_metrics() as m");
    expect(m.members).toBe(4);
    expect(m.active_30d).toBe(2); // alice and bob; eve and the admin did nothing
    expect(m.last_30d).toMatchObject({ meetings_proposed: 1, events: 1, rsvps: 1, jobs: 2, businesses: 1, mentorships_asked: 1, follow_ups: 2 });
    expect(m.weekly).toHaveLength(8);
    expect(JSON.stringify(m)).not.toContain("@");
  });
});
