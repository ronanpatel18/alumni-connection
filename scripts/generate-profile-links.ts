// Creates private "Is this you? Claim or remove" links for invitation emails.
// Writes them to a git-ignored CSV (they work like passwords: don't share the
// file). Skips people who already have an unexpired, unused link, or who are claimed.
//
// Usage: npm run links:generate -- [--group <slug>] [--base-url https://…]
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) && !process.argv.includes("--remote")) {
    console.error(`${url || "(unset)"} is not a local Supabase. Pass --remote to generate links there on purpose.`);
    process.exit(1);
  }
  const baseUrl = (arg("--base-url") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const group = arg("--group");
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });

  let query = db
    .from("people")
    .select("id, full_name, profile_links(expires_at, claimed_at, removed_at)" + (group ? ", group_memberships!inner(groups!inner(slug))" : ""))
    .eq("status", "seeded")
    .order("full_name");
  if (group) query = query.eq("group_memberships.groups.slug", group);
  const { data: people, error } = await query.returns<
    { id: string; full_name: string; profile_links: { expires_at: string; claimed_at: string | null; removed_at: string | null }[] }[]
  >();
  if (error) throw error;

  const rows: string[] = ["name,claim_url,remove_url"];
  for (const person of people) {
    const hasLiveLink = person.profile_links.some((l) => !l.claimed_at && !l.removed_at && new Date(l.expires_at) > new Date());
    if (hasLiveLink) continue;
    const token = randomBytes(32).toString("base64url");
    const { error: insertError } = await db
      .from("profile_links")
      .insert({ person_id: person.id, token_sha256: createHash("sha256").update(token).digest("hex") });
    if (insertError) throw insertError;
    rows.push([`"${person.full_name.replace(/"/g, '""')}"`, `${baseUrl}/claim/${token}`, `${baseUrl}/remove/${token}`].join(","));
  }

  mkdirSync("data/private", { recursive: true });
  const file = `data/private/profile-links-${new Date().toISOString().slice(0, 10)}${group ? `-${group}` : ""}.csv`;
  writeFileSync(file, `${rows.join("\n")}\n`, { mode: 0o600 });
  console.log(`${rows.length - 1} new links → ${file} (keep private; links expire in 90 days)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
