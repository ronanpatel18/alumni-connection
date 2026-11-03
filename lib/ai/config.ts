// Which model runs which task. Everything is chosen by environment variables,
// so switching between local Ollama, a hosted open model and Claude is a config
// change. See .env.example and docs/ARCHITECTURE.md §6b.
import { z } from "zod";

export type AiMode = "fixture" | "live" | "record";
export type ChatProvider = "ollama" | "openai-compatible" | "anthropic";
export type EmbedProvider = "ollama" | "openai-compatible" | "fixture";
/** `extract` = short structured jobs (summaries, query parsing); `write` = prose (explanations, outreach). */
export type AiTaskKind = "extract" | "write";

const envSchema = z.object({
  AI_MODE: z.enum(["fixture", "live", "record"]).default("fixture"),
  AI_EXTRACT_PROVIDER: z.enum(["ollama", "openai-compatible", "anthropic"]).default("ollama"),
  AI_EXTRACT_MODEL: z.string().default("gpt-oss:20b"),
  AI_WRITE_PROVIDER: z.enum(["ollama", "openai-compatible", "anthropic"]).default("ollama"),
  AI_WRITE_MODEL: z.string().default("gpt-oss:20b"),
  AI_EMBED_PROVIDER: z.enum(["ollama", "openai-compatible", "fixture"]).default("ollama"),
  AI_EMBED_MODEL: z.string().default("bge-m3"),
  AI_EMBED_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  AI_FALLBACK: z.enum(["anthropic", "none"]).default("none"),
  AI_FALLBACK_MODEL: z.string().default("claude-haiku-5-5"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434/v1"),
  OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
});

export interface AiConfig {
  mode: AiMode;
  chat: Record<AiTaskKind, { provider: ChatProvider; model: string }>;
  embed: { provider: EmbedProvider; model: string; dimensions: number };
  fallback: { provider: "anthropic"; model: string } | null;
  ollamaBaseUrl: string;
  openAiCompatBaseUrl: string | undefined;
  openAiCompatApiKey: string | undefined;
}

export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  // Treat `KEY=` (empty, as in a fresh .env.local) the same as unset.
  const e = envSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  return {
    mode: e.AI_MODE,
    chat: {
      extract: { provider: e.AI_EXTRACT_PROVIDER, model: e.AI_EXTRACT_MODEL },
      write: { provider: e.AI_WRITE_PROVIDER, model: e.AI_WRITE_MODEL },
    },
    embed: { provider: e.AI_EMBED_PROVIDER, model: e.AI_EMBED_MODEL, dimensions: e.AI_EMBED_DIMENSIONS },
    fallback: e.AI_FALLBACK === "anthropic" ? { provider: "anthropic", model: e.AI_FALLBACK_MODEL } : null,
    ollamaBaseUrl: e.OLLAMA_BASE_URL,
    openAiCompatBaseUrl: e.OPENAI_COMPAT_BASE_URL,
    openAiCompatApiKey: e.OPENAI_COMPAT_API_KEY,
  };
}
