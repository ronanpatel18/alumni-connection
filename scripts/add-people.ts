// Adds people to the directory by name and looks each one up on the web:
// UW–Madison class year, work history and location (the same job the
// "Add people" admin page runs).
//
// Usage: npm run add-people -- "Jane Doe" "John Q. Public" [--hint "Epic Systems, Madison"] [--dry-run]
//   --dry-run  search and print what was found; create and save nothing
import { createClient } from "@supabase/supabase-js";
import { createAi } from "@/lib/ai";
import { lookupPerson } from "@/lib/enrichment/person-lookup";
import { searchConfigured, searchProvider } from "@/lib/enrichment/providers";
import { addPeopleByName, cleanName, runPersonLookup } from "@/lib/enrichment/save-person";

async function main() {
  const args = process.argv.slice(2);
  const hintAt = args.indexOf("--hint");
  const hint = hintAt >= 0 ? args[hintAt + 1] : null;
  const dryRun = args.includes("--dry-run");
  const names = args.filter((a, i) => !a.startsWith("--") && (hintAt < 0 || i !== hintAt + 1));
  if (!names.length) throw new Error('Give at least one name: npm run add-people -- "Jane Doe"');
  if (!searchConfigured()) throw new Error("No web search configured: add a search key to .env.local (see .env.example) or run npm run search:start.");

  const ai = createAi();
  console.log(`Search: ${searchProvider()} · model: ${ai.config.mode === "fixture" ? "none (AI_MODE=fixture: patterns only)" : ai.config.chat.extract.model}${dryRun ? " · dry run" : ""}\n`);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });

  if (dryRun) {
    const { data: industries } = await db.from("industries").select("slug, name").returns<{ slug: string; name: string }[]>().then((r) => r, () => ({ data: null }));
    for (const name of names) {
      const found = await lookupPerson({ fullName: cleanName(name), hint }, { ai, industries: industries ?? [] });
      console.log(`${cleanName(name)}\n${JSON.stringify(found, null, 2)}\n`);
    }
    return;
  }
  for (const result of await addPeopleByName(db, names, null)) {
    if (result.status !== "added") {
      console.log(`· ${result.name}: skipped (${result.status})`);
      continue;
    }
    const outcome = await runPersonLookup(db, ai, { personId: result.personId, jobId: result.jobId, hint });
    console.log(`${outcome.status === "failed" ? "✗" : "✓"} ${result.name} (${outcome.status})\n    ${[...outcome.changes, ...outcome.notes].join("\n    ") || "nothing found"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
