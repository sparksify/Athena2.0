// Phase 6 classifier evaluation — 50 labeled replies through the REAL
// classifier prompt. Reports accuracy, per-class confusion, and the share of
// replies that would have auto-replied. Requires ANTHROPIC_API_KEY.
//
//   pnpm exec tsx scripts/eval/classify-replies.ts [replies.json]
//
// A JSON file of {body, label} rows swaps in the 50 real replies for the
// official proof once they exist; the committed fixture is realistic but
// synthetic and says so.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { ALL_CLASSIFICATIONS, CLASS_DESCRIPTIONS, CLASSIFY_MODEL, isAutoReplyEligible } from "@athena/core";

type Row = { body: string; label: string };

async function main() {
  const file = process.argv[2] ?? resolve(import.meta.dirname, "replies.fixture.json");
  const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required to run the classifier.");
    process.exit(1);
  }
  const provider = new AnthropicProvider();
  const schema = {
    type: "object",
    properties: { classification: { type: "string", enum: [...ALL_CLASSIFICATIONS] }, confidence: { type: "number" }, summary: { type: "string" } },
    required: ["classification", "confidence", "summary"], additionalProperties: false,
  };
  const system = [
    "You classify inbound email replies to a franchise-consulting reactivation outreach. Return exactly one class and a calibrated confidence (0-1).",
    "Classes:", ...ALL_CLASSIFICATIONS.map((c) => `- ${c}: ${CLASS_DESCRIPTIONS[c]}`),
    "Rules: confidence ≥ 0.9 only when the reply is unmistakable. Auto-replies, out-of-office, and empty bodies are `ambiguous`. Any request to stop contact is `unsubscribe`. Prefer `ambiguous` over guessing.",
  ].join("\n");

  let correct = 0, autoReplies = 0, wrongAutoReplies = 0, cost = 0;
  const confusion: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const res = await provider.complete({
      model: CLASSIFY_MODEL, system, maxTokens: 200, jsonSchema: schema,
      messages: [{ role: "user", content: `Recent thread (oldest first):\n\n[outbound] Quick question\nHi — still curious about franchise ownership?\n\n[inbound] Re: Quick question\n${r.body}\n\n---\n\nClassify the LAST inbound message above.` }],
    });
    cost += res.costUsd;
    const out = res.json as { classification: string; confidence: number };
    const ok = out.classification === r.label;
    if (ok) correct++;
    confusion[r.label] ??= {};
    confusion[r.label]![out.classification] = (confusion[r.label]![out.classification] ?? 0) + 1;
    if (isAutoReplyEligible(out.classification, out.confidence)) {
      autoReplies++;
      if (!ok) wrongAutoReplies++;
    }
    console.log(`${ok ? "✓" : "✗"} ${r.label.padEnd(24)} → ${out.classification.padEnd(24)} ${out.confidence.toFixed(2)}  ${r.body.slice(0, 60)}`);
  }
  console.log(`\naccuracy ${correct}/${rows.length} = ${((correct / rows.length) * 100).toFixed(1)}%`);
  console.log(`would auto-reply: ${autoReplies} (${wrongAutoReplies} of those misclassified — must be 0 for the gate)`);
  console.log(`cost $${cost.toFixed(4)} on ${CLASSIFY_MODEL}`);
  console.log("\nconfusion (label → predicted):");
  for (const [label, preds] of Object.entries(confusion)) console.log(`  ${label}: ${JSON.stringify(preds)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
