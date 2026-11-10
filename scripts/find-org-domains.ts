// Fills organizations.domain and .website for employers that have none, so
// the contact pipeline (npm run contacts) has a domain to look people up at.
// One web search per organization; a domain is accepted only when it is
// plainly the organization's own name (lib/enrichment/org-domain.ts).
// Anything uncertain is left blank and listed for a person to fill in.
//
// Usage: npm run org-domains -- [--write] [--names "A,B"] [--limit N]
//   Without --write it only reports what it would save.
import { createClient } from "@supabase/supabase-js";
import { pickDomain } from "@/lib/enrichment/org-domain";
import { searchConfigured, webSearch } from "@/lib/enrichment/search";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const write = process.argv.includes("--write");
const names = arg("--names")
  ?.split(",")
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);
const limit = Number(arg("--limit") ?? Infinity);

async function main() {
  if (!searchConfigured()) {
    console.error("No web search configured: run npm run search:start (SearXNG), or set SEARCH_PROVIDER=tavily and TAVILY_API_KEY.");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (write && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) && !process.argv.includes("--confirm-remote")) {
    console.error(`Refusing to write to ${url || "(unset)"}. This isn't a local database; add --confirm-remote if you mean it.`);
    process.exit(1);
  }
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const { data, error } = await db.from("organizations").select("id, name").is("domain", null).order("name");
  if (error) throw error;
  const orgs = data.filter((o) => !names || names.includes(o.name.toLowerCase())).slice(0, limit);
  console.log(`${orgs.length} organizations without a domain. ${write ? "Saving." : "Dry run (add --write to save)."}\n`);

  let found = 0;
  const unsure: string[] = [];
  for (const org of orgs) {
    let hits: { url: string; title: string }[] = [];
    try {
      hits = (await webSearch(`${org.name} official website`, { maxResults: 8 })).flatMap((r) => (r.url ? [{ url: r.url, title: r.title ?? "" }] : []));
    } catch (searchError) {
      console.log(`${org.name}: search failed (${String((searchError as Error).message).slice(0, 80)})`);
      unsure.push(org.name);
      continue;
    }
    const choice = pickDomain(org.name, hits);
    if (!choice) {
      unsure.push(org.name);
      console.log(`${org.name}: not sure, left blank`);
      continue;
    }
    found++;
    console.log(`${org.name}: ${choice.domain} (${choice.reason})`);
    if (!write) continue;
    const { error: updateError } = await db.from("organizations").update({ domain: choice.domain, website: choice.website }).eq("id", org.id);
    // organizations.domain is unique: the same employer entered twice under two spellings.
    if (updateError?.code === "23505") console.log(`  not saved: another organization already has ${choice.domain} (a duplicate employer record?)`);
    else if (updateError) throw updateError;
  }

  console.log(`\n${write ? "Saved" : "Would save"} ${found} domains; ${unsure.length} left blank.`);
  if (unsure.length) console.log(`Left blank (set organizations.domain by hand if you know it): ${unsure.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
