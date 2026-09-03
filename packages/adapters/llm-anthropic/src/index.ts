import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmRequest, LlmResponse } from "@athena/contracts";

// USD per million tokens. Extend as models are adopted.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, workspaceId = process.env.ANTHROPIC_WORKSPACE_ID) {
    // Identity-linked Console keys must name the workspace they act in;
    // workspace-scoped keys ignore the header.
    this.client = new Anthropic({
      apiKey,
      ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
      ...(req.jsonSchema
        ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } }
        : {}),
    });

    if (response.stop_reason === "refusal") {
      throw new Error("LLM refused the request");
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const pricing = PRICING[response.model] ?? PRICING["claude-opus-5"]!;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      text,
      json: req.jsonSchema ? JSON.parse(text) : undefined,
      model: response.model,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000,
    };
  }
}
