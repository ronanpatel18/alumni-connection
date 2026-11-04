// Fills AI summaries and embeddings for profiles that don't have them, without
// running Inngest. Uses whatever AI_MODE is configured (fixture by default = $0).
// Usage: npm run dev:summaries -- [limit]
import { createClient } from "@supabase/supabase-js";
import { createAi, factsHash } from "@/lib/ai";
import { embeddingText, loadProfileFacts } from "@/lib/profile-facts";

async function main() {
  const limit = Number(process.argv[2] ?? 200);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run against ${url || "(unset)"}: use the Inngest job outside local development.`);
    process.exit(1);
  }
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const ai = createAi();
  console.log(`AI mode: ${ai.config.mode}`);

  const { data: rows, error } = await db.from("people").select("id").is("ai_summary", null).neq("status", "opted_out").limit(limit);
  if (error) throw error;

  let done = 0;
  let failed = 0;
  for (const { id } of rows) {
    const loaded = await loadProfileFacts(db, id);
    if (!loaded) continue;
    let summary;
    try {
      // Free tiers limit requests per minute: on a 429, wait a minute and retry (up to 3 times).
      for (let attempt = 1; ; attempt++) {
        try {
          summary = await ai.summarizeProfile(loaded.facts);
          break;
        } catch (error) {
          if (!/\b429\b/.test(String((error as Error).message)) || attempt >= 3) throw error;
          console.warn(`  rate-limited; waiting 60s (attempt ${attempt}/2)`);
          await new Promise((resolve) => setTimeout(resolve, 60_000));
        }
      }
    } catch (error) {
      // One slow or rate-limited answer shouldn't stop the rest; rerun to fill gaps.
      failed++;
      console.warn(`  skipped ${loaded.facts.fullName}: ${(error as Error).message.slice(0, 120)}`);
      continue;
    }
    const [embedding] = await ai.embed([embeddingText(loaded.facts, summary.summary)]);
    const { error: updateError } = await db
      .from("people")
      .update({ ai_summary: summary.summary, summary_input_hash: factsHash(loaded.facts), embedding: JSON.stringify(embedding) })
      .eq("id", id);
    if (updateError) throw updateError;
    done++;
    if (done % 50 === 0) console.log(`${done}/${rows.length}`);
  }
  console.log(`Summarized ${done} profiles${failed ? `; ${failed} skipped (run again to retry)` : ""}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
