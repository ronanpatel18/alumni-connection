import { createHash, randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;

const sha = (token: string) => createHash("sha256").update(token).digest("hex");

async function seededPerson(): Promise<{ id: string; full_name: string; email: string | null }> {
  const { rows } = await db.query<{ id: string; full_name: string; email: string | null }>(
    `select p.id, p.full_name,
            (select value from contact_points c where c.person_id = p.id and c.kind = 'email' limit 1) as email
       from people p
      where p.status = 'seeded' and p.claimed_by_user_id is null
        and not exists (select 1 from profile_links l where l.person_id = p.id)
      order by p.full_name limit 1`,
  );
  return rows[0];
}

async function linkFor(personId: string, expiresIn = "90 days"): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(`insert into profile_links (person_id, token_sha256, expires_at) values ($1, $2, now() + $3::interval)`, [
    personId,
    sha(token),
    expiresIn,
  ]);
  return token;
}

async function call<T = Record<string, unknown>>(sql: string, params: unknown[]) {
  const { rows } = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return rows[0].r;
}

beforeAll(async () => {
  db = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("profile links", () => {
  it("show only name, class year and groups; reject unknown and expired tokens", async () => {
    const person = await seededPerson();
    const token = await linkFor(person.id);
    const identity = await call<{ state: string; name: string; class_year: number }>("profile_link_identity($1)", [sha(token)]);
    expect(identity.state).toBe("valid");
    expect(identity.name).toBe(person.full_name);
    expect(Object.keys(identity).sort()).toEqual(["class_year", "groups", "name", "state"]);

    expect(await call("profile_link_identity($1)", [sha("not-a-real-token")])).toEqual({ state: "invalid" });

    const other = await seededPerson();
    const expired = await linkFor(other.id, "-1 day");
    expect(await call("profile_link_identity($1)", [sha(expired)])).toEqual({ state: "expired" });
  });

  it("can't be called by members or anonymous visitors", async () => {
    await expect(asUser(db, null, () => db.query("select profile_link_identity('x')"))).rejects.toThrow(/permission denied/);
    const user = await createUser(db, "nosy@example.com", "member");
    await expect(asUser(db, user, () => db.query("select remove_profile_by_link('x')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, user, () => db.query("select id from profile_links"))).rejects.toThrow(/permission denied/);
  });
});

describe("claim_profile", () => {
  it("approves at once when the signed-in email matches one on file, and verifies the member", async () => {
    const person = await seededPerson();
    expect(person.email).toBeTruthy();
    const token = await linkFor(person.id);
    const user = await createUser(db, person.email!);

    const result = await call<{ status: string }>("claim_profile($1, $2, $3)", [sha(token), user, person.email!.toUpperCase()]);
    expect(result.status).toBe("approved");

    const { rows } = await db.query<{ status: string; claimed_by_user_id: string; role: string; member_person: string }>(
      `select p.status, p.claimed_by_user_id, m.role, m.person_id as member_person
         from people p join members m on m.user_id = $2 where p.id = $1`,
      [person.id, user],
    );
    expect(rows[0]).toMatchObject({ status: "claimed", claimed_by_user_id: user, role: "member", member_person: person.id });
    expect(await call<{ state: string }>("profile_link_identity($1)", [sha(token)])).toMatchObject({ state: "claimed" });
  });

  it("records a pending request when the email doesn't match, without granting access", async () => {
    const person = await seededPerson();
    const token = await linkFor(person.id);
    const user = await createUser(db, "someone-else@example.com");

    const result = await call<{ status: string }>("claim_profile($1, $2, $3)", [sha(token), user, "someone-else@example.com"]);
    expect(result.status).toBe("pending");

    const { rows } = await db.query<{ status: string; role: string }>(
      "select p.status, m.role from people p, members m where p.id = $1 and m.user_id = $2",
      [person.id, user],
    );
    expect(rows[0]).toEqual({ status: "seeded", role: "pending" });
    const own = await asUser(db, user, () => db.query<{ status: string }>("select status from claim_requests"));
    expect(own.rows).toEqual([{ status: "pending" }]);
  });

  it("refuses a profile someone else already claimed, and a second profile for the same account", async () => {
    const person = await seededPerson();
    const token = await linkFor(person.id);
    const first = await createUser(db, person.email!);
    expect((await call<{ status: string }>("claim_profile($1, $2, $3)", [sha(token), first, person.email!])).status).toBe("approved");

    const second = await createUser(db, "late@example.com");
    expect(await call("claim_profile($1, $2, $3)", [sha(token), second, "late@example.com"])).toMatchObject({ reason: "already_claimed" });

    const another = await seededPerson();
    const anotherToken = await linkFor(another.id);
    expect(await call("claim_profile($1, $2, $3)", [sha(anotherToken), first, person.email!])).toMatchObject({ reason: "has_other_profile" });
  });
});

describe("remove_profile_by_link", () => {
  it("deletes the profile and its derived data, keeps only a suppression record, and is idempotent", async () => {
    const person = await seededPerson();
    const token = await linkFor(person.id);
    await db.query("insert into person_external_ids (person_id, source, external_id) values ($1, 'test-source', 'abc-123')", [person.id]);
    const note = await createUser(db, "note-taker@example.com", "member");
    await db.query("insert into notes (owner_user_id, person_id, body) values ($1, $2, 'private')", [note, person.id]);

    expect(await call("remove_profile_by_link($1)", [sha(token)])).toEqual({ status: "removed" });

    const remaining = await db.query<{ n: number }>(
      `select (select count(*) from people where id = $1)
            + (select count(*) from contact_points where person_id = $1)
            + (select count(*) from notes where person_id = $1)
            + (select count(*) from educations where person_id = $1) as n`,
      [person.id],
    );
    expect(Number(remaining.rows[0].n)).toBe(0);

    const suppressed = await db.query<{ source: string | null; email_sha256: string | null }>(
      "select source, email_sha256 from suppression_list where full_name = $1",
      [person.full_name],
    );
    expect(suppressed.rows.some((r) => r.source === "test-source")).toBe(true);
    if (person.email) {
      const expected = createHash("sha256").update(person.email.toLowerCase()).digest("hex");
      expect(suppressed.rows.some((r) => r.email_sha256 === expected)).toBe(true);
    }

    expect(await call("remove_profile_by_link($1)", [sha(token)])).toEqual({ status: "removed" });
    expect(await call("profile_link_identity($1)", [sha(token)])).toEqual({ state: "removed" });

    // The audit log notes that a removal happened, without naming the person.
    const audit = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_log where action = 'profile.removed_by_subject' order by id desc limit 1",
    );
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(person.full_name);
  });
});
