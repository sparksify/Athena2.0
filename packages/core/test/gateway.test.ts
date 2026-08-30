import type { LlmProvider } from "@athena/contracts";
import { describe, expect, it } from "vitest";
import { costRecord, org } from "@athena/db/schema";
import { LlmGateway } from "../src/llm/gateway.js";
import { testDb } from "./helpers.js";

const mockProvider: LlmProvider = {
  name: "mock",
  async complete(req) {
    return {
      text: "hello",
      model: req.model,
      inputTokens: 12,
      outputTokens: 5,
      costUsd: 0.000123,
    };
  },
};

describe("LlmGateway", () => {
  it("writes a cost_record for every call", async () => {
    const { db, client } = await testDb();
    const [o] = await db.insert(org).values({ name: "Test" }).returning();

    const gateway = new LlmGateway(mockProvider, db);
    const res = await gateway.complete(
      { model: "test-model", messages: [{ role: "user", content: "hi" }] },
      { orgId: o!.id },
    );
    expect(res.text).toBe("hello");

    const costs = await db.select().from(costRecord);
    expect(costs).toHaveLength(1);
    expect(costs[0]!.category).toBe("llm");
    expect(costs[0]!.provider).toBe("mock");
    expect(Number(costs[0]!.amountUsd)).toBeCloseTo(0.000123, 6);
    expect((costs[0]!.detail as { model: string }).model).toBe("test-model");
    await client.close();
  });
});
