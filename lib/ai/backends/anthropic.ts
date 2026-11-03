// Claude, used as the fallback when an open model's answer fails validation or
// is low-confidence (docs/ARCHITECTURE.md §6b). Structured outputs guarantee the
// response matches the Zod schema.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiRefusalError, AiValidationError, type ChatBackend, type JsonRequest } from "../backend";

export class AnthropicBackend implements ChatBackend {
  readonly name: string;
  private readonly client = new Anthropic();

  constructor(private readonly model: string) {
    this.name = `anthropic:${model}`;
  }

  async completeJson<T>(request: JsonRequest<T>): Promise<T> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4096,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      output_config: { format: zodOutputFormat(request.schema), effort: "low" },
    });

    if (response.stop_reason === "refusal") {
      throw new AiRefusalError(`${this.name} declined ${request.task}: ${response.stop_details?.explanation ?? "no details"}`);
    }
    if (response.parsed_output == null) {
      throw new AiValidationError(`${this.name} returned no parseable output for ${request.task}`, JSON.stringify(response.content));
    }
    return response.parsed_output as T;
  }
}
