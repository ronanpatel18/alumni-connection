// Fills AI summaries and embeddings for profiles that don't have them, without
// running Inngest. Uses whatever AI_MODE is configured (fixture by default = $0).
// Usage: npm run dev:summaries -- [limit]
import { createClient } from "@supabase/supabase-js";
import { createAi } from "@/lib/ai";
import { SUMMARY_BULLETS, summarizePerson } from "@/lib/summaries";

async function main() {
  const limit = Number(process.argv[2] ?? 200);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run against ${url || "(unset)"}: use the Inngest job or the daily cron outside local development.`);
    process.exit(1);
  }
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const ai = createAi();
  console.log(`AI mode: ${ai.config.mode}`);

  const { data, error } = await db.from("people").select("id, full_name, ai_summary, summary_input_hash").neq("status", "opted_out").order("full_name");
  if (error) throw error;
  // No summary, fewer than three bullets, or one built from facts while the model was unreachable.
  const rows = data.filter((p) => (p.ai_summary?.length ?? 0) !== SUMMARY_BULLETS || !p.summary_input_hash).slice(0, limit);
  console.log(`${rows.length} of ${data.length} profiles need a summary.`);

  const tally: Record<string, number> = {};
  for (const row of rows) {
    // Free tiers limit requests per minute.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const outcome = await summarizePerson(db, ai, row.id, { force: true });
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    if (outcome === "from_facts") console.warn(`  ${row.full_name}: model unavailable, built from facts (run again to have it rewritten)`);
  }
  console.log(`Done: ${tally.written ?? 0} written by the model, ${tally.from_facts ?? 0} built from facts.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
