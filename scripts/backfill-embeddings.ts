// Embeds profiles for prompt search without running Inngest. Only profiles
// with no embedding, or one from a different model, are done.
// Usage: npm run embeddings -- [--limit N] [--force]
//   Needs AI_MODE=live and AI_EMBED_PROVIDER=gemini (free tier) for real vectors;
//   in fixture mode it writes the deterministic test vectors.
import { createClient } from "@supabase/supabase-js";
import { createAi } from "@/lib/ai";
import { embedPeople, peopleNeedingEmbeddings } from "@/lib/embeddings";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run against ${url || "(unset)"}: outside local development, send the people/embeddings.backfill event to Inngest.`);
    process.exit(1);
  }
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
  const ai = createAi();
  const ids = await peopleNeedingEmbeddings(db, ai.embedModel, { limit: Number(arg("--limit") ?? 5000), force: process.argv.includes("--force") });
  console.log(`Embedding model: ${ai.embedModel}. ${ids.length} profiles to embed.`);

  let done = 0;
  // Free tiers limit requests per minute: on a 429, wait a minute and carry on from where it stopped.
  for (let attempt = 1; done < ids.length; attempt++) {
    const base = done;
    try {
      await embedPeople(db, ai, ids.slice(base), (n) => {
        done = base + n;
        console.log(`  ${done}/${ids.length}`);
      });
      break;
    } catch (error) {
      if (!/\b429\b/.test(String((error as Error).message)) || attempt >= 5) throw error;
      console.warn(`  rate-limited; waiting 60s (attempt ${attempt}/5)`);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }
  console.log(`Embedded ${done} profiles.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
