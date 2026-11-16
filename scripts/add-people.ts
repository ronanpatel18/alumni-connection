// Adds people to the directory by name and looks each one up on the web:
// UW–Madison class year, work history and location (the same job the
// "Add people" admin page runs).
//
// Usage: npm run add-people -- "Jane Doe" "John Q. Public" [--hint "Epic Systems, Madison"] [--dry-run]
//        npm run add-people -- --gaps [--limit N] [--concurrency N]
//   --dry-run  search and print what was found; create and save nothing
//   --gaps     look up existing unclaimed profiles missing a class year, work history or location
import { createClient } from "@supabase/supabase-js";
import { createAi } from "@/lib/ai";
import { lookupPerson } from "@/lib/enrichment/person-lookup";
import { searchConfigured, searchProvider } from "@/lib/enrichment/providers";
import { addPeopleByName, cleanName, LOOKUP_PROVIDER, profilesWithGaps, runLookupBatch, runPersonLookup } from "@/lib/enrichment/save-person";

async function main() {
  const args = process.argv.slice(2);
  const hintAt = args.indexOf("--hint");
  const hint = hintAt >= 0 ? args[hintAt + 1] : null;
  const dryRun = args.includes("--dry-run");
  const valueOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const valueFlags = ["--hint", "--limit", "--concurrency"];
  const names = args.filter((a, i) => !a.startsWith("--") && !valueFlags.includes(args[i - 1]));
  if (args.includes("--gaps")) return lookUpGaps(Number(valueOf("--limit") ?? 1000), Number(valueOf("--concurrency") ?? 2));
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

async function lookUpGaps(limit: number, concurrency: number) {
  if (!searchConfigured()) throw new Error("No web search configured: add a search key to .env.local (see .env.example) or run npm run search:start.");
  const ai = createAi();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const gaps = await profilesWithGaps(db);
  const ids = gaps.next.slice(0, limit);
  console.log(
    `${gaps.total} profiles with gaps (${gaps.missingClassYear} no class year, ${gaps.missingWork} no work history, ${gaps.missingLocation} no location). ` +
      `Looking up ${ids.length} with ${searchProvider()}, ${concurrency} at a time.\n`,
  );
  const { data: names } = await db.from("people").select("id, full_name").in("id", ids).returns<{ id: string; full_name: string }[]>();
  const nameOf = new Map((names ?? []).map((p) => [p.id, p.full_name]));
  const lookups: { personId: string; jobId: string }[] = [];
  for (const personId of ids) {
    const { data: job, error } = await db.from("enrichment_jobs").insert({ person_id: personId, kind: "full", status: "queued", provider: LOOKUP_PROVIDER }).select("id").single<{ id: string }>();
    if (error) throw error;
    lookups.push({ personId, jobId: job.id });
  }
  let changed = 0;
  const { done, stoppedEarly } = await runLookupBatch(db, ai, lookups, {
    concurrency,
    onDone: ({ personId }, outcome) => {
      if (outcome.changes.length) changed++;
      console.log(`${outcome.status === "failed" ? "✗" : outcome.changes.length ? "✓" : "·"} ${nameOf.get(personId)}\n    ${[...outcome.changes, ...outcome.notes].join("\n    ") || "nothing new"}`);
    },
  });
  console.log(`\n${done} of ${ids.length} looked up: ${changed} gained something.${stoppedEarly ? " Stopped early: the AI model or web search isn’t available. Run this again later; the rest are still queued as gaps." : ""}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
