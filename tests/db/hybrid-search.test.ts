import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixtureEmbedBackend } from "@/lib/ai/backends/fixture";
import { asUser, createTestDatabase, createUser } from "./harness";

let db: PGlite;
let pendingUser: string;
let memberUser: string;
let otherMember: string;
let chicago: number;
let embedded: { id: string; full_name: string }[];
let queryVector: string;

const embedder = new FixtureEmbedBackend(1024);
const vec = async (text: string) => JSON.stringify((await embedder.embed([text]))[0]);

interface Row {
  id: string;
  full_name: string;
  status: string;
  matched: string[];
}

async function hybrid(userId: string | null, args: Record<string, unknown>) {
  const names = Object.keys(args);
  const sql = `select * from search_people_hybrid(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
  return asUser(db, userId, async () => (await db.query<Row>(sql, Object.values(args))).rows);
}

beforeAll(async () => {
  db = await createTestDatabase();
  pendingUser = await createUser(db, "pending@example.com");
  memberUser = await createUser(db, "member@example.com", "member");
  otherMember = await createUser(db, "other@example.com", "member");
  chicago = (await db.query<{ id: number }>("select id from places where name = 'Chicago'")).rows[0].id;

  // Three profiles get an embedding; the other ~5,000 have none.
  embedded = (await db.query<{ id: string; full_name: string }>("select id, full_name from people where status = 'seeded' order by id limit 3")).rows;
  const texts = ["climate tech venture capital investor", "pediatric nurse practitioner", "commercial real estate broker"];
  for (const [i, person] of embedded.entries()) {
    await db.query("update people set embedding = $1, embedding_model = 'fixture' where id = $2", [await vec(texts[i]), person.id]);
  }
  queryVector = await vec("venture capital investor in climate tech");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("search_people_hybrid", () => {
  it("is closed to anonymous visitors and returns nothing to unverified users", async () => {
    await expect(hybrid(null, { p_keywords: ["finance"] })).rejects.toThrow(/permission denied/);
    expect(await hybrid(pendingUser, { p_keywords: ["finance"], p_industry_slugs: ["finance"] })).toHaveLength(0);
  });

  it("never returns an opted-out profile, even when it is the best match", async () => {
    const target = embedded[0].id;
    await db.query("update people set status = 'opted_out' where id = $1", [target]);
    const rows = await hybrid(memberUser, { p_query_embedding: queryVector, p_embedding_model: "fixture" });
    expect(rows.map((r) => r.id)).not.toContain(target);
    await db.query("update people set status = 'seeded' where id = $1", [target]);
  });

  it("ranks the closest embedding first and ignores vectors from another model", async () => {
    const rows = await hybrid(memberUser, { p_query_embedding: queryVector, p_embedding_model: "fixture" });
    expect(rows[0].id).toBe(embedded[0].id);
    expect(rows).toHaveLength(3); // only embedded profiles can match on similarity alone

    const otherModel = await hybrid(memberUser, { p_query_embedding: queryVector, p_embedding_model: "gemini:gemini-embedding-2" });
    expect(otherModel).toHaveLength(0);
  });

  it("still finds profiles that have no embedding, through filters and keywords", async () => {
    const rows = await hybrid(memberUser, {
      p_keywords: ["leasing", "acquisitions"],
      p_query_embedding: queryVector,
      p_embedding_model: "fixture",
      p_industry_slugs: ["real-estate"],
      p_place_id: chicago,
    });
    expect(rows.length).toBeGreaterThan(3);
    const ids = rows.map((r) => r.id);
    const { rows: withVectors } = await db.query<{ n: number }>("select count(*)::int as n from people where id = any($1) and embedding is not null", [ids]);
    expect(withVectors[0].n).toBeLessThan(rows.length);
    expect(rows[0].matched).toContain("industry");
  });

  it("treats location as a hard filter and the rest as preferences", async () => {
    const rows = await hybrid(memberUser, { p_industry_slugs: ["finance"], p_open_to: ["mentoring"], p_place_id: chicago, p_radius_miles: 25, p_limit: 60 });
    expect(rows.length).toBeGreaterThan(0);
    const { rows: far } = await db.query<{ n: number }>(
      `select count(*)::int as n from people p, places o
        where o.id = $2 and p.id = any($1) and not st_dwithin(p.location, o.location, 25 * 1609.344)`,
      [rows.map((r) => r.id), chicago],
    );
    expect(far[0].n).toBe(0);
    // Someone matching both preferences outranks someone matching one.
    const counts = rows.map((r) => r.matched.length);
    expect(counts[0]).toBeGreaterThanOrEqual(counts[counts.length - 1]);
    expect(rows.every((r) => r.matched.length > 0)).toBe(true);
  });

  it("honors confirmed-only", async () => {
    const rows = await hybrid(memberUser, { p_industry_slugs: ["finance"], p_confirmed_only: true });
    expect(rows.every((r) => r.status === "claimed" || r.status === "verified")).toBe(true);
  });
});

describe("ai_search_cache", () => {
  it("is private to the member who searched", async () => {
    await asUser(db, memberUser, () =>
      db.query("insert into ai_search_cache (owner_user_id, query_hash, parsed) values ($1, 'h1', '{}')", [memberUser]),
    );
    const mine = await asUser(db, memberUser, () => db.query("select 1 from ai_search_cache"));
    const theirs = await asUser(db, otherMember, () => db.query("select 1 from ai_search_cache"));
    expect(mine.rows).toHaveLength(1);
    expect(theirs.rows).toHaveLength(0);
    await expect(
      asUser(db, otherMember, () => db.query("insert into ai_search_cache (owner_user_id, query_hash, parsed) values ($1, 'h2', '{}')", [memberUser])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, pendingUser, () => db.query("insert into ai_search_cache (owner_user_id, query_hash, parsed) values ($1, 'h3', '{}')", [pendingUser])),
    ).rejects.toThrow(/row-level security/);
  });
});
