import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let pendingUser: string;
let memberUser: string;
let ownerUser: string;
let adminUser: string;
let ownerPerson: string;
let seededPerson: string;

const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => db.query<T>(text, params).then((r) => r.rows);

async function finding(over: Record<string, unknown> = {}) {
  const f = {
    person_id: seededPerson,
    kind: "email",
    value: `f${Math.random().toString(36).slice(2, 10)}@firm.example.com`,
    label: "work",
    source: "web",
    source_detail: "firm.example.com",
    source_url: "https://firm.example.com/team",
    evidence_quote: "Pat Example, Partner pat@firm.example.com",
    confidence: 0.9,
    verification: JSON.stringify({ status: "valid", method: "zerobounce" }),
    pattern_guessed: false,
    review_reasons: "{}",
    status: "pending",
    ...over,
  };
  const keys = Object.keys(f);
  const rows = await sql<{ id: string; value: string }>(
    `insert into contact_findings (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, value`,
    Object.values(f),
  );
  return rows[0];
}

const decideAs = (userId: string, id: string, decision: string) =>
  asUser(db, userId, () => sql<{ r: { status: string; visibility?: string } }>("select admin_decide_contact_finding($1, $2) as r", [id, decision])).then((rows) => rows[0].r);
const visibleTo = (userId: string, value: string) => asUser(db, userId, () => sql("select 1 from contact_points where value = $1", [value])).then((rows) => rows.length);

beforeAll(async () => {
  db = await createTestDatabase();
  pendingUser = await createUser(db, "pending@example.com");
  memberUser = await createUser(db, "member@example.com", "member");
  ownerUser = await createUser(db, "owner@example.com", "member");
  adminUser = await createUser(db, "admin@example.com", "admin");
  const people = await sql<{ id: string }>("select id from people where status = 'seeded' order by id limit 2");
  ownerPerson = people[0].id;
  seededPerson = people[1].id;
  await sql("update people set claimed_by_user_id = $1, status = 'verified' where id = $2", [ownerUser, ownerPerson]);
  await sql("delete from contact_points where person_id = any($1)", [[ownerPerson, seededPerson]]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("who can read a contact detail", () => {
  it("members see member-entered details and approved ones, never a private third-party detail", async () => {
    await sql(
      `insert into contact_points (person_id, kind, value, source, visibility) values
         ($1, 'email', 'own@example.com', 'self', 'private'),
         ($1, 'phone', '+16082620001', 'registry', 'private'),
         ($1, 'email', 'found@firm.example.com', 'web', 'private'),
         ($1, 'email', 'shown@firm.example.com', 'hunter', 'members')`,
      [ownerPerson],
    );
    const read = (userId: string) => asUser(db, userId, () => sql<{ value: string }>("select value from contact_points where person_id = $1 order by value", [ownerPerson])).then((rows) => rows.map((r) => r.value));
    expect(await read(memberUser)).toEqual(["own@example.com", "shown@firm.example.com"]);
    // The person themselves, and administrators, see everything held about them.
    expect(await read(ownerUser)).toHaveLength(4);
    expect(await read(adminUser)).toHaveLength(4);
    expect(await read(pendingUser)).toEqual([]);
  });
});

describe("contact_findings", () => {
  it("is readable by administrators only, and writable by no member", async () => {
    const f = await finding();
    const count = (userId: string) => asUser(db, userId, () => sql("select 1 from contact_findings where id = $1", [f.id])).then((rows) => rows.length);
    expect(await count(adminUser)).toBe(1);
    expect(await count(memberUser)).toBe(0);
    expect(await count(pendingUser)).toBe(0);
    await expect(asUser(db, null, () => sql("select 1 from contact_findings"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, adminUser, () => sql("update contact_findings set status = 'approved' where id = $1", [f.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, memberUser, () => sql("select * from admin_contact_queue()"))).rejects.toThrow(/Administrators only/);
    await expect(decideAs(memberUser, f.id, "show")).rejects.toThrow(/Administrators only/);
  });

  it("a pending finding is invisible to members until an administrator shows it", async () => {
    const f = await finding();
    expect(await visibleTo(memberUser, f.value)).toBe(0);
    const queue = await asUser(db, adminUser, () => sql<{ id: string }>("select id from admin_contact_queue()"));
    expect(queue.map((q) => q.id)).toContain(f.id);

    expect(await decideAs(adminUser, f.id, "show")).toEqual({ status: "approved", visibility: "members" });
    expect(await visibleTo(memberUser, f.value)).toBe(1);
    const [point] = await sql<{ source: string; source_url: string; verification: string; verified_at: string | null }>(
      "select source, source_url, verification, verified_at from contact_points where value = $1",
      [f.value],
    );
    expect(point).toMatchObject({ source: "web", source_url: "https://firm.example.com/team", verification: "verifier" });
    expect(point.verified_at).not.toBeNull();
    // Recorded for per-source deletion and audit; a second decision changes nothing.
    expect(await sql("select 1 from field_provenance where person_id = $1 and field = 'contact_points' and source = 'web'", [seededPerson])).toHaveLength(1);
    expect(await sql("select 1 from audit_log where action = 'contact_finding.show' and target_id = $1", [f.id])).toHaveLength(1);
    expect((await decideAs(adminUser, f.id, "reject")).status).toBe("already_decided");
    expect(await visibleTo(memberUser, f.value)).toBe(1);
  });

  it("'keep private' stores the value without showing it", async () => {
    const f = await finding({ kind: "phone", value: "+16082620055", label: "personal", source: "people_search", review_reasons: "{personal,third_party_phone}" });
    expect(await decideAs(adminUser, f.id, "keep_private")).toEqual({ status: "approved", visibility: "private" });
    expect(await visibleTo(memberUser, f.value)).toBe(0);
    expect(await visibleTo(adminUser, f.value)).toBe(1);
  });

  it("refuses to show personal details, unverified emails and unconfirmed pattern guesses", async () => {
    const personal = await finding({ label: "personal", value: "pat@gmail.example.com" });
    await expect(decideAs(adminUser, personal.id, "show")).rejects.toThrow(/Only work contact details/);

    const unchecked = await finding({ verification: JSON.stringify({ status: "unknown" }) });
    await expect(decideAs(adminUser, unchecked.id, "show")).rejects.toThrow(/validity check/);

    const guess = await finding({ pattern_guessed: true, verification: JSON.stringify({ status: "domain_ok", method: "mx" }) });
    await expect(decideAs(adminUser, guess.id, "show")).rejects.toThrow(/validity check/);

    // Read from a page, on a working mail domain: allowed. A verified pattern guess: allowed, and labeled.
    const onPage = await finding({ verification: JSON.stringify({ status: "domain_ok", method: "mx" }) });
    expect((await decideAs(adminUser, onPage.id, "show")).visibility).toBe("members");
    const confirmed = await finding({ pattern_guessed: true, source: "hunter" });
    await decideAs(adminUser, confirmed.id, "show");
    const [point] = await sql<{ verification: string }>("select verification from contact_points where value = $1", [confirmed.value]);
    expect(point.verification).toBe("pattern_verified");
    for (const f of [personal, unchecked, guess]) expect(await visibleTo(adminUser, f.value)).toBe(0);
  });

  it("rejecting a privately stored finding deletes the stored value", async () => {
    const f = await finding({ status: "stored" });
    await sql("insert into contact_points (person_id, kind, value, source, visibility) values ($1, 'email', $2, 'web', 'private')", [seededPerson, f.value]);
    const stored = await asUser(db, adminUser, () => sql<{ id: string }>("select id from admin_contact_queue('stored')"));
    expect(stored.map((q) => q.id)).toContain(f.id);
    expect((await decideAs(adminUser, f.id, "reject")).status).toBe("rejected");
    expect(await sql("select 1 from contact_points where value = $1", [f.value])).toEqual([]);
  });

  it("never overwrites a detail the member entered themselves", async () => {
    const f = await finding({ person_id: ownerPerson, value: "own@example.com" });
    await decideAs(adminUser, f.id, "keep_private");
    const [point] = await sql<{ source: string }>("select source from contact_points where person_id = $1 and value = 'own@example.com'", [ownerPerson]);
    expect(point.source).toBe("self");
  });
});

describe("removal and suppression", () => {
  it("blocks a third-party email that belongs to someone who asked to be removed", async () => {
    await sql(
      `insert into suppression_list (institution_id, full_name, email_sha256, reason)
       select institution_id, 'Removed Person', encode(sha256(convert_to('removed@firm.example.com', 'UTF8')), 'hex'), 'test' from people where id = $1`,
      [seededPerson],
    );
    const insert = (source: string, value: string) =>
      sql("insert into contact_points (person_id, kind, value, source, visibility) values ($1, 'email', $2, $3, 'private')", [seededPerson, value, source]);
    await expect(insert("web", "Removed@Firm.example.com")).rejects.toThrow(/asked to be removed/);
    const f = await finding({ value: "removed@firm.example.com" });
    await expect(decideAs(adminUser, f.id, "keep_private")).rejects.toThrow(/asked to be removed/);
    await expect(insert("web", "someone.else@firm.example.com")).resolves.toBeDefined();
  });

  it("deleting a profile deletes its findings, and a source can be dropped on its own", async () => {
    const [{ id: person }] = await sql<{ id: string }>("select id from people where status = 'seeded' order by id desc limit 1");
    const a = await finding({ person_id: person, source: "people_search", source_detail: "spokeo.com", label: "personal" });
    const b = await finding({ person_id: person, source: "hunter" });
    await sql("insert into contact_points (person_id, kind, value, source, source_detail, visibility) values ($1, 'email', $2, 'people_search', 'spokeo.com', 'private')", [person, a.value]);

    await expect(asUser(db, adminUser, () => sql("select delete_contacts_from_source('people_search')"))).rejects.toThrow(/permission denied/);
    await expect(sql("select delete_contacts_from_source('self')")).rejects.toThrow(/not a deletable source/);
    const [{ r }] = await sql<{ r: { contact_points: number; findings: number } }>("select delete_contacts_from_source('people_search', 'spokeo.com') as r");
    expect(r).toEqual({ contact_points: 1, findings: 1 });
    expect(await sql("select 1 from contact_findings where id = $1", [b.id])).toHaveLength(1);

    await sql("delete from people where id = $1", [person]);
    expect(await sql("select 1 from contact_findings where id = $1", [b.id])).toEqual([]);
  });
});
