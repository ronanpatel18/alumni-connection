// Local development only: sets a member's role so you can use the app without
// building the verification flow. Usage: npm run dev:promote -- you@example.com admin
import { createClient } from "@supabase/supabase-js";

const ROLES = ["pending", "member", "chapter_leader", "admin", "super_admin"];

async function main() {
  const [email, role = "member"] = process.argv.slice(2);
  if (!email || !ROLES.includes(role)) {
    console.error(`Usage: npm run dev:promote -- <email> [${ROLES.join("|")}]`);
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run against ${url || "(unset)"}: this script only touches a local Supabase.`);
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("members")
    .update({ role, verified_at: role === "pending" ? null : new Date().toISOString(), verification_method: "dev" })
    .eq("email", email.toLowerCase())
    .select("user_id, role");
  if (error) throw error;
  if (!data.length) {
    console.error(`No member with email ${email}. Sign in once at /login first so the account exists.`);
    process.exit(1);
  }
  console.log(`${email} is now ${role}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
