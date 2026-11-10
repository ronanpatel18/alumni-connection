// Fixture mode: no network, no cost. Replays a recorded response from
// lib/ai/fixtures/<task>/<hash>.json when one exists, otherwise returns the
// request's deterministic stub. Record mode wraps a live backend and saves
// what it returns so the same request replays offline afterwards.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatBackend, EmbedBackend, JsonRequest } from "../backend";

const FIXTURES_DIR = join(process.cwd(), "lib", "ai", "fixtures");

export function fixtureKey(request: Pick<JsonRequest<unknown>, "system" | "user">): string {
  return createHash("sha256").update(request.system).update("\0").update(request.user).digest("hex").slice(0, 16);
}

function fixturePath(task: string, key: string) {
  return join(FIXTURES_DIR, task, `${key}.json`);
}

export class FixtureChatBackend implements ChatBackend {
  readonly name = "fixture";

  async completeJson<T>(request: JsonRequest<T>): Promise<T> {
    const path = fixturePath(request.task, fixtureKey(request));
    if (existsSync(path)) {
      return request.schema.parse(JSON.parse(readFileSync(path, "utf8")));
    }
    return request.schema.parse(request.stub());
  }
}

export class RecordingChatBackend implements ChatBackend {
  readonly name: string;

  constructor(private readonly live: ChatBackend) {
    this.name = `record(${live.name})`;
  }

  async completeJson<T>(request: JsonRequest<T>): Promise<T> {
    const result = await this.live.completeJson(request);
    const path = fixturePath(request.task, fixtureKey(request));
    mkdirSync(join(FIXTURES_DIR, request.task), { recursive: true });
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
}

/**
 * Deterministic "hashed bag of words" embeddings. Not semantic, but texts that
 * share words land close together, which is enough to exercise similarity
 * search in development without a model.
 */
export class FixtureEmbedBackend implements EmbedBackend {
  readonly name = "fixture";

  constructor(private readonly dimensions: number) {}

  // The kind is ignored: profiles and searches share one hashed space.
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        const digest = createHash("sha256").update(token).digest();
        const index = digest.readUInt32BE(0) % this.dimensions;
        vector[index] += digest[4] & 1 ? 1 : -1;
      }
      const norm = Math.hypot(...vector) || 1;
      return vector.map((v) => v / norm);
    });
  }
}
