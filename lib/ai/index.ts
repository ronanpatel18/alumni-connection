// The app's single entry point for AI. Each task is routed to the model chosen
// in config (lib/ai/config.ts); open models are the default, Claude is the
// optional fallback, and fixture mode makes no network calls at all.
import type { SearchVocabulary } from "@/lib/search/parse-query";
import { AiRefusalError, AiValidationError, type ChatBackend, type EmbedBackend, type JsonRequest } from "./backend";
import { AnthropicBackend } from "./backends/anthropic";
import { FixtureChatBackend, FixtureEmbedBackend, RecordingChatBackend } from "./backends/fixture";
import { OpenAiCompatibleBackend } from "./backends/openai-compatible";
import { type AiConfig, type AiTaskKind, type ChatProvider, loadAiConfig } from "./config";
import {
  ENRICH_SYSTEM,
  EXPLAIN_SYSTEM,
  OUTREACH_SYSTEM,
  type OutreachInput,
  SUMMARY_SYSTEM,
  enrichStub,
  enrichUserPrompt,
  explainStub,
  explainUserPrompt,
  outreachStub,
  outreachUserPrompt,
  querySystemPrompt,
  queryStub,
  summaryStub,
  summaryUserPrompt,
} from "./prompts";
import {
  type CandidateForExplanation,
  type Enrichment,
  type EnrichmentInput,
  enrichmentSchema,
  type MatchExplanations,
  type OutreachDraft,
  type ParsedQuery,
  type ProfileFacts,
  type ProfileSummary,
  matchExplanationsSchema,
  outreachDraftSchema,
  parsedQuerySchema,
  profileSummarySchema,
} from "./schemas";

/** Summaries below this confidence are re-run on the fallback model, if one is configured. */
const MIN_SUMMARY_CONFIDENCE = 0.5;

function liveChatBackend(config: AiConfig, provider: ChatProvider, model: string): ChatBackend {
  switch (provider) {
    case "ollama":
      return new OpenAiCompatibleBackend({ name: "ollama", baseURL: config.ollamaBaseUrl, model });
    case "openai-compatible":
      if (!config.openAiCompatBaseUrl) throw new Error("OPENAI_COMPAT_BASE_URL is required for the openai-compatible provider");
      return new OpenAiCompatibleBackend({
        name: "openai-compatible",
        baseURL: config.openAiCompatBaseUrl,
        apiKey: config.openAiCompatApiKey,
        model,
      });
    case "gemini":
      if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is required for the gemini provider");
      return new OpenAiCompatibleBackend({ name: "gemini", baseURL: config.geminiBaseUrl, apiKey: config.geminiApiKey, model });
    case "anthropic":
      return new AnthropicBackend(model);
  }
}

export interface Ai {
  readonly config: AiConfig;
  summarizeProfile(facts: ProfileFacts): Promise<ProfileSummary & { model: string }>;
  parseSearchQuery(text: string, vocab: SearchVocabulary): Promise<ParsedQuery>;
  explainMatches(goal: string, candidates: CandidateForExplanation[]): Promise<MatchExplanations>;
  draftOutreach(input: OutreachInput): Promise<OutreachDraft>;
  extractEnrichment(input: EnrichmentInput): Promise<Enrichment & { model: string }>;
  embed(texts: string[]): Promise<number[][]>;
}

export function createAi(config: AiConfig = loadAiConfig()): Ai {
  const chat: Record<AiTaskKind, ChatBackend> = {
    extract: chatBackendFor("extract"),
    write: chatBackendFor("write"),
  };
  const fallback: ChatBackend | null =
    config.mode === "live" && config.fallback ? new AnthropicBackend(config.fallback.model) : null;
  const embedder: EmbedBackend =
    config.mode === "fixture" || config.embed.provider === "fixture"
      ? new FixtureEmbedBackend(config.embed.dimensions)
      : new OpenAiCompatibleBackend({
          name: config.embed.provider,
          baseURL: config.embed.provider === "ollama" ? config.ollamaBaseUrl : (config.openAiCompatBaseUrl ?? ""),
          apiKey: config.openAiCompatApiKey,
          model: config.embed.model,
        });

  function chatBackendFor(kind: AiTaskKind): ChatBackend {
    if (config.mode === "fixture") return new FixtureChatBackend();
    const live = liveChatBackend(config, config.chat[kind].provider, config.chat[kind].model);
    return config.mode === "record" ? new RecordingChatBackend(live) : live;
  }

  async function run<T>(kind: AiTaskKind, request: JsonRequest<T>): Promise<{ result: T; model: string }> {
    const primary = chat[kind];
    try {
      return { result: await primary.completeJson(request), model: primary.name };
    } catch (error) {
      if (fallback && (error instanceof AiValidationError || error instanceof AiRefusalError)) {
        return { result: await fallback.completeJson(request), model: fallback.name };
      }
      throw error;
    }
  }

  return {
    config,

    async summarizeProfile(facts) {
      const request: JsonRequest<ProfileSummary> = {
        task: "summarize-profile",
        schema: profileSummarySchema,
        system: SUMMARY_SYSTEM,
        user: summaryUserPrompt(facts),
        stub: () => summaryStub(facts),
      };
      const first = await run("extract", request);
      if (fallback && first.result.confidence < MIN_SUMMARY_CONFIDENCE && first.model !== fallback.name) {
        const second = await fallback.completeJson(request);
        return { ...second, model: fallback.name };
      }
      return { ...first.result, model: first.model };
    },

    async parseSearchQuery(text, vocab) {
      const { result } = await run("extract", {
        task: "parse-query",
        schema: parsedQuerySchema,
        system: querySystemPrompt(vocab),
        user: text,
        stub: () => queryStub(text, vocab),
      });
      // Never trust slugs or places the model made up.
      const knownSlugs = new Set(vocab.industries.map((i) => i.slug));
      const knownPlace = vocab.places.find((p) => p.name === result.city && p.state === result.state);
      return {
        ...result,
        industrySlugs: result.industrySlugs.filter((slug) => knownSlugs.has(slug)),
        city: knownPlace ? result.city : null,
        state: knownPlace ? result.state : null,
      };
    },

    async explainMatches(goal, candidates) {
      if (!candidates.length) return { matches: [] };
      const { result } = await run("write", {
        task: "explain-matches",
        schema: matchExplanationsSchema,
        system: EXPLAIN_SYSTEM,
        user: explainUserPrompt(goal, candidates),
        stub: () => explainStub(candidates),
      });
      const ids = new Set(candidates.map((c) => c.personId));
      return { matches: result.matches.filter((m) => ids.has(m.personId)) };
    },

    async draftOutreach(input) {
      const { result } = await run("write", {
        task: "draft-outreach",
        schema: outreachDraftSchema,
        system: OUTREACH_SYSTEM,
        user: outreachUserPrompt(input),
        stub: () => outreachStub(input),
      });
      // Always end with the sender's sign-off, so a "[Your name]" placeholder is never lost.
      const body = result.body.trimEnd();
      return body.endsWith(input.senderName) ? { ...result, body } : { ...result, body: `${body}\n\n${input.senderName}` };
    },

    async extractEnrichment(input) {
      const { result, model } = await run("extract", {
        task: "extract-enrichment",
        schema: enrichmentSchema,
        system: ENRICH_SYSTEM,
        user: enrichUserPrompt(input),
        stub: enrichStub,
      });
      return { ...result, model };
    },

    async embed(texts) {
      const vectors = await embedder.embed(texts);
      for (const vector of vectors) {
        if (vector.length !== config.embed.dimensions) {
          throw new Error(
            `${embedder.name} returned ${vector.length}-dim embeddings; the database expects ${config.embed.dimensions}. ` +
              "Pick a 1024-dim model (bge-m3, Qwen3-Embedding-0.6B) or migrate the column.",
          );
        }
      }
      return vectors;
    },
  };
}

let shared: Ai | null = null;

/** Process-wide instance built from environment variables. */
export function getAi(): Ai {
  shared ??= createAi();
  return shared;
}

export type { Enrichment, EnrichmentInput, EnrichmentSource, ParsedQuery, ProfileFacts, ProfileSummary } from "./schemas";
export { factsHash } from "./prompts";
