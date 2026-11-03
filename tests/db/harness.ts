// Runs the real Supabase migrations and seed inside PGlite (in-process Postgres
// with PostGIS, pgvector and pg_trgm), so database behavior and RLS can be tested
// without Docker. A small shim stands in for the parts of Supabase that aren't
// in plain Postgres: the `auth` schema, `auth.uid()` and the API roles.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { postgis } from "@electric-sql/pglite-postgis";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const SEED_FILE = join(ROOT, "tests", "db", "fixtures", "synthetic-alumni.sql");

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema if not exists extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
`;

export async function createTestDatabase({ seed = true } = {}) {
  const db = new PGlite({ extensions: { vector, postgis, pg_trgm } });
  await db.exec(SUPABASE_SHIM);
  await db.exec("set search_path = public, extensions;");

  const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  if (seed) {
    try {
      await db.exec(readFileSync(SEED_FILE, "utf8"));
    } catch (error) {
      throw new Error(`Synthetic fixture failed: ${(error as Error).message}`);
    }
  }
  return db;
}

/** Runs `fn` as an API user, the way PostgREST would: role + JWT claims. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  const role = userId ? "authenticated" : "anon";
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

/** Creates an auth user (the members row is created by trigger) and sets its role. */
export async function createUser(db: PGlite, email: string, role = "pending"): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  const id = rows[0].id;
  if (role !== "pending") {
    await db.query("update public.members set role = $2, verified_at = now(), verification_method = 'dev' where user_id = $1", [
      id,
      role,
    ]);
  }
  return id;
}
