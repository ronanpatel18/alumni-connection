import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let owner: string;
let stranger: string;
let personId: string;

const profile = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    full_name: "Pat Example",
    current_title: "Vice President, Partnerships",
    employer: "Lakeshore Realty",
    place_id: null,
    industry_id: null,
    class_year: 2009,
    school: "Wisconsin School of Business",
    degree: "BBA",
    major: "Real Estate",
    open_to: ["networking", "mentoring"],
    bio: "I help Midwest companies grow.",
    ...overrides,
  });

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createUser(db, "owner@example.com", "member");
  stranger = await createUser(db, "stranger@example.com", "member");
  const { rows } = await db.query<{ id: string }>("select id from people where status = 'seeded' order by full_name limit 1");
  personId = rows[0].id;
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [owner, personId]);
  await db.query("update members set person_id = $2 where user_id = $1", [owner, personId]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("update_my_profile", () => {
  it("updates only the caller's own profile and records the member as the source", async () => {
    await asUser(db, owner, () => db.query("select update_my_profile($1::jsonb)", [profile()]));

    const { rows } = await db.query<{ full_name: string; headline: string; open_to: string[]; bio: string }>(
      "select full_name, headline, open_to, bio from people where id = $1",
      [personId],
    );
    expect(rows[0]).toMatchObject({
      full_name: "Pat Example",
      headline: "Vice President, Partnerships at Lakeshore Realty",
      open_to: ["networking", "mentoring"],
      bio: "I help Midwest companies grow.",
    });

    const sources = await db.query<{ field: string }>("select field from field_provenance where person_id = $1 and source = 'self'", [personId]);
    expect(sources.rows.map((r) => r.field)).toEqual(expect.arrayContaining(["full_name", "current_title", "educations", "bio"]));
  });

  it("moves the previous job to history when the title or employer changes", async () => {
    await asUser(db, owner, () => db.query("select update_my_profile($1::jsonb)", [profile({ current_title: "Partner", employer: "North Star Advisors" })]));
    const { rows } = await db.query<{ title: string; is_current: boolean }>(
      "select title, is_current from positions where person_id = $1 and title in ('Partner', 'Vice President, Partnerships')",
      [personId],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { title: "Partner", is_current: true },
        { title: "Vice President, Partnerships", is_current: false },
      ]),
    );
  });

  it("replaces imported education with the member's own entry", async () => {
    const { rows } = await db.query<{ degree: string; grad_year: number; verified_by: string | null }>(
      "select degree, grad_year, verified_by from educations where person_id = $1",
      [personId],
    );
    expect(rows).toEqual([{ degree: "BBA", grad_year: 2009, verified_by: null }]);
  });

  it("refuses members without a claimed profile, and anonymous callers", async () => {
    await expect(asUser(db, stranger, () => db.query("select update_my_profile($1::jsonb)", [profile()]))).rejects.toThrow(/not claimed a profile/);
    await expect(asUser(db, null, () => db.query("select update_my_profile($1::jsonb)", [profile()]))).rejects.toThrow(/permission denied/);
  });
});

describe("the post-claim setup save", () => {
  it("leaves education alone when no education fields are sent", async () => {
    await db.query("delete from educations where person_id = $1", [personId]);
    await db.query(
      "insert into educations (person_id, institution_id, degree, grad_year, verified_by) select $1, institution_id, 'MBA', 1999, 'roster' from people where id = $1",
      [personId],
    );
    await db.query(
      "insert into educations (person_id, institution_id, degree, grad_year, verified_by) select $1, institution_id, 'BBA', 1994, 'source' from people where id = $1",
      [personId],
    );
    await db.query("update people set bio = 'Keeps this bio' where id = $1", [personId]);

    const p = { full_name: "Setup Member", current_title: "Director", employer: "Acme", place_id: null, industry_id: null, class_year: null, school: null, degree: null, major: null, open_to: ["networking"], bio: "Keeps this bio" };
    await asUser(db, owner, () => db.query("select update_my_profile($1::jsonb)", [JSON.stringify(p)]));

    const { rows } = await db.query<{ degree: string; verified_by: string }>("select degree, verified_by from educations where person_id = $1 order by degree", [personId]);
    expect(rows).toEqual([
      { degree: "BBA", verified_by: "source" },
      { degree: "MBA", verified_by: "roster" },
    ]);
    const { rows: me } = await db.query<{ bio: string; open_to: string[] }>("select bio, open_to from people where id = $1", [personId]);
    expect(me[0]).toEqual({ bio: "Keeps this bio", open_to: ["networking"] });
  });
});

describe("update_my_contacts", () => {
  const contacts = (email: string, emailVisibility = "members", phone = "") =>
    JSON.stringify([
      { kind: "email", value: email, visibility: emailVisibility },
      { kind: "phone", value: phone, visibility: "connections" },
    ]);

  it("saves each detail with its own visibility, and changing an email clears its verified label", async () => {
    await db.query("delete from contact_points where person_id = $1", [personId]);
    await db.query(
      "insert into contact_points (person_id, kind, value, source, visibility, verified_at) values ($1, 'email', 'old@example.com', 'roster', 'members', now())",
      [personId],
    );

    // Same address, new visibility: stays verified and keeps its source.
    await asUser(db, owner, () => db.query("select update_my_contacts($1::jsonb)", [contacts("old@example.com", "private", "+1-608-555-0142")]));
    let rows = (
      await db.query<{ kind: string; value: string; visibility: string; verified: boolean; source: string }>(
        "select kind, value, visibility, verified_at is not null as verified, source from contact_points where person_id = $1 order by kind",
        [personId],
      )
    ).rows;
    expect(rows).toEqual([
      { kind: "email", value: "old@example.com", visibility: "private", verified: true, source: "roster" },
      { kind: "phone", value: "+1-608-555-0142", visibility: "connections", verified: false, source: "self" },
    ]);

    // New address: member-provided and no longer verified. Empty phone deletes it.
    await asUser(db, owner, () => db.query("select update_my_contacts($1::jsonb)", [contacts("new@example.com")]));
    rows = (
      await db.query<{ kind: string; value: string; visibility: string; verified: boolean; source: string }>(
        "select kind, value, visibility, verified_at is not null as verified, source from contact_points where person_id = $1 order by kind",
        [personId],
      )
    ).rows;
    expect(rows).toEqual([{ kind: "email", value: "new@example.com", visibility: "members", verified: false, source: "self" }]);
  });

  it("rejects unknown visibility values and other members' calls", async () => {
    await expect(
      asUser(db, owner, () => db.query("select update_my_contacts($1::jsonb)", [contacts("new@example.com", "public")])),
    ).rejects.toThrow(/Invalid visibility/);
    await expect(asUser(db, stranger, () => db.query("select update_my_contacts($1::jsonb)", [contacts("x@example.com")]))).rejects.toThrow(
      /not claimed a profile/,
    );
  });
});
