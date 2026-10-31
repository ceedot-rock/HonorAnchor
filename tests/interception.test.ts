import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { delegate, fingerprint, issueMandate } from "../src/mandate-gate.js";
import { lead, observer, operator, researcher } from "../src/participants.js";
import { ReceiptTrail, generateEdKeyPair, verifyTrail } from "../src/receipts.js";
import { CrewState, initializeRuntime, join as joinRuntime, sendMessage } from "../src/runtime.js";
import { MandateLedger } from "../src/mandate-gate.js";
import { registerStep } from "../src/runner.js";
import { ScriptedInferenceRunner } from "../src/runner.js";
import { payForResearch } from "../src/tools.js";

async function waitUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("mozaik loop: allowed spend executes via invoke, denied spend is blocked by interception and receipted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-integration-"));
  const issuer = generateEdKeyPair();
  const signers = new Map([
    ["crew-operator", generateEdKeyPair()],
    ["crew-lead", generateEdKeyPair()],
    ["crew-researcher", generateEdKeyPair()],
  ]);
  const trail = new ReceiptTrail(join(dir, "trail.jsonl"), issuer, "test/integration");
  const state = new CrewState({
    ledger: new MandateLedger((rec) => state.emitAction({ ...rec }, rec.caller_agent_id)),
    trail,
    signers,
  });
  initializeRuntime({ state, inferenceRunnerConfig: { runner: new ScriptedInferenceRunner() } });
  joinRuntime(operator);
  joinRuntime(observer);
  joinRuntime(lead);
  joinRuntime(researcher);

  const researcherId = state.actorId("researcher");
  const until = Math.floor(Date.now() / 1000) + 7200;
  const root = issueMandate(state.actorId("lead"), 100, until);
  const hop = delegate(root, researcherId, 40, until);
  void fingerprint(hop);

  registerStep("research-int-allow", {
    calls: [{ name: "pay_for_research", args: { warrant: hop, caller_agent_id: researcherId, cost_cents: 5, task: "integration allow" } }],
    answer: "allow step",
    answerAfterTool: "allowed (scripted)",
  });
  registerStep("research-int-deny", {
    calls: [{ name: "pay_for_research", args: { warrant: hop, caller_agent_id: researcherId, cost_cents: 50, task: "integration deny" } }],
    answer: "deny step",
    answerAfterTool: "denied (scripted)",
  });

  const mark1 = state.observerLog.length;
  sendMessage("STEP:research-int-allow Spend 5 cents.", operator.getId());
  await waitUntil(
    () => state.observerLog.slice(mark1).some((e) => e.event === "model.answer" && e.producer === "Crew Researcher"),
    8000,
    "allow answer",
  );
  assert.equal(state.ledger.spentCents(hop), 5);

  const mark2 = state.observerLog.length;
  sendMessage("STEP:research-int-deny Spend 50 cents.", operator.getId());
  await waitUntil(
    () => state.observerLog.slice(mark2).some((e) => e.event === "model.answer" && e.producer === "Crew Researcher"),
    8000,
    "deny answer",
  );
  // Denied at interception: invoke never ran, spend unchanged.
  assert.equal(state.ledger.spentCents(hop), 5);

  // Direct invoke without any handler still enforces the gate.
  const direct = await payForResearch.invoke({ warrant: hop, caller_agent_id: researcherId, cost_cents: 40, task: "direct" });
  assert.equal((direct as { denied?: boolean }).denied, true);
  assert.equal(state.ledger.spentCents(hop), 5);

  const results = verifyTrail(trail.trailPath, issuer.pubkeyHex);
  assert.ok(results.length >= 3, `expected >=3 receipts, got ${results.length}`);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const decisions = trail.recordsSince(0).filter((r) => r["action"] === "gate.decision");
  assert.equal(decisions.filter((r) => r["verdict"] === "ALLOW").length, 1);
  assert.equal(decisions.filter((r) => r["verdict"] === "DENY").length, 2);

  // False payment claim: model_message interception blocks the answer
  // (no ALLOW receipt since this loop started) and loops back corrected.
  registerStep("research-int-claim", {
    answer: "Payment of 99 cents completed and settled.",
  });
  const mark3 = state.observerLog.length;
  sendMessage("STEP:research-int-claim Report the payment status.", operator.getId());
  await waitUntil(
    () => state.observerLog.slice(mark3).some((e) => e.event === "model.answer" && e.producer === "Crew Researcher"),
    8000,
    "corrected answer",
  );
  assert.ok(state.observerLog.slice(mark3).some((e) => e.event === "interception.payment-claim-blocked"));
  const finalAnswer = state.observerLog
    .slice(mark3)
    .filter((e) => e.event === "model.answer" && e.producer === "Crew Researcher")
    .at(-1)!;
  assert.match(finalAnswer.detail, /Corrected/);
});
