import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let owner: string;
let other: string;
let me: string;
let target: { id: string; full_name: string; org: string };

const match = (rows: unknown[]) =>
  asUser(db, owner, () => db.query<{ person_id: string; matched_by: string }>("select * from match_linkedin_connections($1::jsonb)", [JSON.stringify(rows)])).then(
    (r) => r.rows,
  );

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createUser(db, "owner@example.com", "member");
  other = await createUser(db, "other@example.com", "member");
  const people = (
    await db.query<{ id: string; full_name: string; org: string }>(
      `select p.id, p.full_name, o.name as org from people p join organizations o on o.id = p.current_organization_id
        where p.claimed_by_user_id is null order by p.full_name limit 2`,
    )
  ).rows;
  me = people[0].id;
  target = people[1];
  await db.query("update people set claimed_by_user_id = $1, status = 'claimed' where id = $2", [owner, me]);
  await db.query("update members set person_id = $2 where user_id = $1", [owner, me]);
  await db.query("insert into contact_points (person_id, kind, value, source, visibility) values ($1, 'linkedin', 'https://www.linkedin.com/in/Target-Person/', 'web', 'members')", [
    target.id,
  ]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("match_linkedin_connections", () => {
  it("matches by LinkedIn profile URL, whatever its formatting", async () => {
    const rows = await match([{ first: "Someone", last: "Else", url: "http://linkedin.com/in/target-person?trk=x", company: "" }]);
    expect(rows).toEqual([{ person_id: target.id, matched_by: "profile_url" }]);
    // With the name and employer too, the URL match still wins.
    const [first, ...rest] = target.full_name.split(" ");
    expect(await match([{ first, last: rest.pop(), url: "https://linkedin.com/in/target-person", company: target.org }])).toEqual([{ person_id: target.id, matched_by: "profile_url" }]);
  });

  it("matches by full name only together with the employer", async () => {
    const [first, ...rest] = target.full_name.split(" ");
    const last = rest.pop()!;
    expect(await match([{ first, last, url: "", company: target.org }])).toEqual([{ person_id: target.id, matched_by: "name_and_company" }]);
    expect(await match([{ first, last, url: "", company: "Some Other Company" }])).toEqual([]);
    expect(await match([{ first, last, url: "", company: "" }])).toEqual([]);
  });

  it("stores matches privately", async () => {
    await asUser(db, owner, () => db.query("insert into my_connections (owner_user_id, person_id, matched_by) values ($1, $2, 'profile_url')", [owner, target.id]));
    const theirs = await asUser(db, other, () => db.query("select * from my_connections"));
    expect(theirs.rows).toHaveLength(0);
    await expect(
      asUser(db, other, () => db.query("insert into my_connections (owner_user_id, person_id, matched_by) values ($1, $2, 'profile_url')", [owner, target.id])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("import_my_linkedin_history", () => {
  const run = (p: unknown) => asUser(db, owner, () => db.query<{ r: Record<string, number> }>("select import_my_linkedin_history($1::jsonb) as r", [JSON.stringify(p)])).then((r) => r.rows[0].r);

  it("adds positions and a UW degree, recorded as member-provided", async () => {
    await db.query("delete from educations where person_id = $1", [me]);
    const result = await run({
      positions: [
        { title: "Analyst", company: "First Bank", start_date: "2005-06-01", end_date: "2008-05-01" },
        { title: "Director", company: "Second Co", start_date: "2008-06-01", end_date: null },
      ],
      educations: [{ degree: "BBA", grad_year: 2005 }],
    });
    expect(result).toMatchObject({ added_positions: 2, added_degrees: 1 });
    const edu = await db.query<{ degree: string; grad_year: number }>("select degree, grad_year from educations where person_id = $1", [me]);
    expect(edu.rows).toEqual([{ degree: "BBA", grad_year: 2005 }]);
    const sources = await db.query<{ field: string }>("select field from field_provenance where person_id = $1 and source = 'self'", [me]);
    expect(sources.rows.map((r) => r.field)).toEqual(expect.arrayContaining(["positions", "educations"]));
  });

  it("doesn't duplicate on a second import", async () => {
    const again = await run({ positions: [{ title: "Analyst", company: "First Bank", start_date: "2005-06-01", end_date: "2008-05-01" }], educations: [{ degree: "BBA", grad_year: 2005 }] });
    expect(again).toMatchObject({ added_positions: 0, added_degrees: 0 });
  });

  it("needs a claimed profile", async () => {
    await expect(asUser(db, other, () => db.query("select import_my_linkedin_history('{}'::jsonb)"))).rejects.toThrow(/not claimed a profile/);
  });
});
