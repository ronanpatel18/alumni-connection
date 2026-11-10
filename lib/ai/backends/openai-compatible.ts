// One client for every OpenAI-compatible endpoint: local Ollama, DeepInfra,
// Groq, Together, Fireworks, OpenRouter. Uses strict JSON-schema decoding,
// validates with Zod and retries once with the validation error fed back.
import OpenAI from "openai";
import { z } from "zod";
import { AiValidationError, type ChatBackend, type EmbedBackend, type EmbedKind, type JsonRequest } from "../backend";

function jsonSchemaFor(schema: z.ZodType) {
  // Some OpenAI-compatible hosts reject the `$schema` meta key.
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function describeIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

export class OpenAiCompatibleBackend implements ChatBackend, EmbedBackend {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly embedOptions: { dimensions?: number; geminiTaskPrefix?: boolean };

  constructor(options: {
    name: string;
    baseURL: string;
    apiKey?: string;
    model: string;
    /** Ask for this many dimensions (models that can shorten their output, such as gemini-embedding-2). */
    dimensions?: number;
    /** gemini-embedding-2 takes its task as a text prefix rather than a parameter. */
    geminiTaskPrefix?: boolean;
  }) {
    this.name = `${options.name}:${options.model}`;
    this.model = options.model;
    this.embedOptions = { dimensions: options.dimensions, geminiTaskPrefix: options.geminiTaskPrefix };
    // Ollama ignores the key but the SDK requires one. Free hosted tiers can stall
    // under load, so fail fast instead of waiting the SDK's default 10 minutes.
    this.client = new OpenAI({
      baseURL: options.baseURL,
      apiKey: options.apiKey || "not-needed",
      timeout: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 90_000),
      // Free tiers rate-limit (429); the SDK backs off between retries.
      maxRetries: 3,
    });
  }

  async completeJson<T>(request: JsonRequest<T>): Promise<T> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: request.task.replace(/[^a-zA-Z0-9_-]/g, "_"), schema: jsonSchemaFor(request.schema), strict: true },
        },
      });
      const raw = completion.choices[0]?.message?.content ?? "";

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      const result = request.schema.safeParse(parsed);
      if (result.success) return result.data;

      if (attempt === 1) {
        throw new AiValidationError(`${this.name} returned invalid JSON for ${request.task}`, raw);
      }
      const problem = parsed === undefined ? "it was not valid JSON" : describeIssues(result.error);
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: `That response failed validation (${problem}). Reply with corrected JSON only.` },
      );
    }
    throw new Error("unreachable");
  }

  async embed(texts: string[], kind: EmbedKind = "document"): Promise<number[][]> {
    const input = this.embedOptions.geminiTaskPrefix
      ? texts.map((text) => (kind === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`))
      : texts;
    const response = await this.client.embeddings.create({
      model: this.model,
      input,
      ...(this.embedOptions.dimensions ? { dimensions: this.embedOptions.dimensions } : {}),
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => {
        // Shortened vectors aren't always unit length; cosine search expects them to be.
        const norm = Math.hypot(...d.embedding) || 1;
        return Math.abs(norm - 1) < 1e-3 ? d.embedding : d.embedding.map((v) => v / norm);
      });
  }
}
