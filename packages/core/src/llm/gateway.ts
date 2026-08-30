import type { LlmProvider, LlmRequest, LlmResponse } from "@athena/contracts";
import { costRecord } from "@athena/db/schema";
import { Langfuse } from "langfuse";
import type { EmitTx } from "../events/emit.js";

export interface GatewayCallContext {
  orgId: string;
  agentJobId?: string;
  /** Langfuse trace name; defaults to the request's purpose. */
  traceName?: string;
}

/**
 * The only path core code uses to call an LLM. Every call writes a
 * cost_record (rule 8) and, when Langfuse keys are configured, a trace.
 */
export class LlmGateway {
  private langfuse: Langfuse | null;

  constructor(
    private provider: LlmProvider,
    private db: EmitTx,
  ) {
    this.langfuse =
      process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
        ? new Langfuse({ baseUrl: process.env.LANGFUSE_BASE_URL })
        : null;
  }

  async complete(req: LlmRequest, ctx: GatewayCallContext): Promise<LlmResponse> {
    const started = Date.now();
    const res = await this.provider.complete(req);

    await this.db.insert(costRecord).values({
      orgId: ctx.orgId,
      agentJobId: ctx.agentJobId,
      category: "llm",
      provider: this.provider.name,
      amountUsd: res.costUsd.toFixed(6),
      detail: {
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        durationMs: Date.now() - started,
      },
    });

    if (this.langfuse) {
      this.langfuse.trace({ name: ctx.traceName ?? "llm.complete" }).generation({
        model: res.model,
        input: req.messages,
        output: res.text,
        usage: { input: res.inputTokens, output: res.outputTokens },
      });
      await this.langfuse.flushAsync().catch(() => {});
    }

    return res;
  }
}
