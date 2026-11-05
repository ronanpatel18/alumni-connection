import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let admin: string;
let member: string;

const review = (personId: string, p: Record<string, unknown>, note = "Checked the board listing.") =>
  db.query<{ r: { changed: string[] } }>("select admin_review_profile($1, $2::jsonb, $3) as r", [personId, JSON.stringify(p), note]);

/** An unclaimed, unreviewed profile whose class year is unknown (so it's in the queue). */
async function personNeedingReview(): Promise<{ id: string; full_name: string }> {
  const { rows } = await db.query<{ id: string; full_name: string }>(
    `select p.id, p.full_name from people p
      where p.claimed_by_user_id is null and p.alumni_status <> 'not_alumnus'
        and not exists (select 1 from profile_reviews r where r.person_id = p.id)
        and not exists (select 1 from claim_requests c where c.person_id = p.id)
      order by p.full_name limit 1`,
  );
  await db.query("update educations set grad_year = null where person_id = $1", [rows[0].id]);
  return rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin@example.com", "admin");
  member = await createUser(db, "member@example.com", "member");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_review_queue", () => {
  it("lists unclaimed profiles with gaps, and only for administrators", async () => {
    const { rows } = await asUser(db, admin, () => db.query<{ reasons: string[] }>("select * from admin_review_queue()"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.reasons.length > 0)).toBe(true);

    await expect(asUser(db, member, () => db.query("select * from admin_review_queue()"))).rejects.toThrow(/Administrators only/);
    await expect(asUser(db, null, () => db.query("select * from admin_review_queue()"))).rejects.toThrow(/permission denied/);
  });
});

describe("admin_review_profile", () => {
  it("saves corrections with 'admin' as their source and takes the profile out of the queue", async () => {
    const person = await personNeedingReview();
    const { rows } = await asUser(db, admin, () =>
      review(person.id, {
        full_name: person.full_name,
        current_title: "Chief Financial Officer",
        employer: "Lakeshore Realty",
        city: "Chicago",
        state: "IL",
        alumni_status: "source_stated",
        educations: [{ degree: "BBA", major: "Finance", grad_year: 2004, school: "Wisconsin School of Business" }],
      }),
    );
    expect(rows[0].r.changed).toEqual(expect.arrayContaining(["current_title", "educations", "location"]));

    const after = await db.query<{ metro: string; headline: string; years: number[]; sources: string[] }>(
      `select p.metro, p.headline,
              array(select grad_year from educations e where e.person_id = p.id and e.verified_by = 'admin') as years,
              array(select field from field_provenance f where f.person_id = p.id and f.source = 'admin' order by field) as sources
         from people p where p.id = $1`,
      [person.id],
    );
    expect(after.rows[0]).toMatchObject({ metro: "Chicago", headline: "Chief Financial Officer at Lakeshore Realty", years: [2004] });
    expect(after.rows[0].sources).toEqual(expect.arrayContaining(["current_title", "educations", "location"]));

    const queue = await asUser(db, admin, () => db.query<{ person_id: string }>("select person_id from admin_review_queue()"));
    expect(queue.rows.map((r) => r.person_id)).not.toContain(person.id);
  });

  it("deletes an education entry the reviewer empties", async () => {
    const person = await personNeedingReview();
    const { rows: edu } = await db.query<{ id: string }>(
      "insert into educations (person_id, institution_id, degree) select id, institution_id, 'BA' from people where id = $1 returning id",
      [person.id],
    );
    await asUser(db, admin, () => review(person.id, { full_name: person.full_name, educations: [{ id: edu[0].id, degree: "", major: "", grad_year: "" }] }));
    const { rows } = await db.query("select 1 from educations where id = $1", [edu[0].id]);
    expect(rows).toHaveLength(0);
  });

  it("requires a note, a sensible class year, and an administrator", async () => {
    const person = await personNeedingReview();
    await expect(asUser(db, admin, () => review(person.id, { full_name: person.full_name }, " "))).rejects.toThrow(/review note/);
    await expect(
      asUser(db, admin, () => review(person.id, { full_name: person.full_name, educations: [{ degree: "BBA", grad_year: 1850 }] })),
    ).rejects.toThrow(/Class year/);
    await expect(asUser(db, member, () => review(person.id, { full_name: person.full_name }))).rejects.toThrow(/Administrators only/);
  });

  it("leaves claimed profiles to their owners", async () => {
    const person = await personNeedingReview();
    await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [member, person.id]);
    await expect(asUser(db, admin, () => review(person.id, { full_name: person.full_name }))).rejects.toThrow(/belongs to a member/);
  });
});

describe("admin_decide_claim", () => {
  it("approves a manual claim: links the profile and verifies the member", async () => {
    const claimant = await createUser(db, "claimant@example.com", "pending");
    const person = await personNeedingReview();
    const { rows: req } = await db.query<{ id: string }>(
      "insert into claim_requests (person_id, user_id, method) values ($1, $2, 'manual') returning id",
      [person.id, claimant],
    );

    await expect(asUser(db, member, () => db.query("select admin_decide_claim($1, true)", [req[0].id]))).rejects.toThrow(/Administrators only/);

    const { rows } = await asUser(db, admin, () => db.query<{ r: { status: string } }>("select admin_decide_claim($1, true) as r", [req[0].id]));
    expect(rows[0].r.status).toBe("approved");

    const state = await db.query<{ claimed_by_user_id: string; role: string; linked: string }>(
      `select p.claimed_by_user_id, m.role, m.person_id as linked from people p, members m where p.id = $1 and m.user_id = $2`,
      [person.id, claimant],
    );
    expect(state.rows[0]).toEqual({ claimed_by_user_id: claimant, role: "member", linked: person.id });

    const again = await asUser(db, admin, () => db.query<{ r: { reason: string } }>("select admin_decide_claim($1, false) as r", [req[0].id]));
    expect(again.rows[0].r.reason).toBe("already_decided");
  });

  it("tells the claimant once when approved, and points them at setup", async () => {
    const claimant = await createUser(db, "approved@example.com", "pending");
    const person = await personNeedingReview();
    const { rows: req } = await db.query<{ id: string }>("insert into claim_requests (person_id, user_id, method) values ($1, $2, 'manual') returning id", [person.id, claimant]);
    const notices = () => db.query<{ kind: string; link: string }>("select kind, link from notifications where user_id = $1", [claimant]).then((r) => r.rows);

    expect(await notices()).toEqual([]);
    await asUser(db, admin, () => db.query("select admin_decide_claim($1, true)", [req[0].id]));
    expect(await notices()).toEqual([{ kind: "claim_approved", link: "/welcome" }]);

    await asUser(db, admin, () => db.query("select admin_decide_claim($1, true)", [req[0].id]));
    expect(await notices()).toHaveLength(1);
  });

  it("sends no approval notice for a declined claim or one approved by email match", async () => {
    const declined = await createUser(db, "declined@example.com", "pending");
    const matched = await createUser(db, "matched@example.com", "pending");
    const person = await personNeedingReview();
    const { rows: req } = await db.query<{ id: string }>("insert into claim_requests (person_id, user_id, method) values ($1, $2, 'manual') returning id", [person.id, declined]);
    await asUser(db, admin, () => db.query("select admin_decide_claim($1, false)", [req[0].id]));
    await db.query("insert into claim_requests (person_id, user_id, method, status, decided_at) values ($1, $2, 'email_match', 'approved', now())", [person.id, matched]);

    const { rows } = await db.query("select id from notifications where user_id = any($1)", [[declined, matched]]);
    expect(rows).toEqual([]);
  });

  it("declines a claim without linking anything", async () => {
    const claimant = await createUser(db, "someone@example.com", "pending");
    const person = await personNeedingReview();
    const { rows: req } = await db.query<{ id: string }>(
      "insert into claim_requests (person_id, user_id, method) values ($1, $2, 'manual') returning id",
      [person.id, claimant],
    );
    await asUser(db, admin, () => db.query("select admin_decide_claim($1, false)", [req[0].id]));
    const { rows } = await db.query<{ status: string; claimed: string | null }>(
      "select c.status, p.claimed_by_user_id as claimed from claim_requests c join people p on p.id = c.person_id where c.id = $1",
      [req[0].id],
    );
    expect(rows[0]).toEqual({ status: "rejected", claimed: null });
  });
});
