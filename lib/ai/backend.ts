import type { z } from "zod";

export interface JsonRequest<T> {
  /** Stable task name; also the fixture folder name. */
  task: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  /** Deterministic answer used in fixture mode when no recording exists. */
  stub: () => T;
}

export interface ChatBackend {
  readonly name: string;
  completeJson<T>(request: JsonRequest<T>): Promise<T>;
}

export interface EmbedBackend {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** The model returned JSON that failed schema validation even after a retry. */
export class AiValidationError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "AiValidationError";
  }
}

/** The model declined to answer (e.g. a safety refusal). */
export class AiRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRefusalError";
  }
}
