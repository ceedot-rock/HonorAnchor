/**
 * demo.ts — the Freestyle demo: three scenarios + a concurrency
 * demonstration, mirroring the Python driver's frozen scope.
 *
 * 1. Hire/pay under mandate (scripted inference, simulated cents).
 * 2. Overspend blocked on camera: single-call over-cap, then
 *    cumulative overflow (two spends that each fit alone).
 * 3. Tampered mandate refused + anonymous seat rejected + trail verify.
 * + Concurrency: Lead and Researcher loops genuinely overlapping.
 *
 * Everything is receipted into runs/<runId>/trail.jsonl. Exit 0 only
 * when every expected stage passed and the whole trail verifies.
 * No live rail, no real money, fresh ephemeral keys (in memory only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { delegate, fingerprint, issueMandate, WarrantError, type Warrant } from "./mandate-gate.js";
import { lead, observer, operator, researcher } from "./participants.js";
import { ReceiptTrail, generateEdKeyPair, sha256OfFile, verifyTrail } from "./receipts.js";
import { initializeRuntime, join as joinRuntime, sendMessage } from "./runtime.js";
import { CrewState } from "./runtime.js";
import { MandateLedger } from "./mandate-gate.js";
import { registerStep } from "./runner.js";
import { ScriptedInferenceRunner } from "./runner.js";

const JOB = "Find the simulated price of a research lookup and prove the crew can pay for it under a Warrant-shaped mandate (simulated cents, no real payment).";
const ROOT_CAP = 100;
const HOP_CAP = 40;

function stage(name: string, status: string, detail = ""): void {
  console.log(`[${status.padStart(7)}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function waitForAnswer(state: CrewState, producerName: string, mark: number): Promise<void> {
  await waitUntil(
    () => state.observerLog.slice(mark).some((e) => e.event === "model.answer" && e.producer === producerName),
    8000,
    `model.answer from ${producerName}`,
  );
}

async function main(): Promise<number> {
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "").replace("T", "T").slice(0, 17)}Z`;
  const runDir = join(process.cwd(), "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const trailPath = join(runDir, "trail.jsonl");

  const issuer = generateEdKeyPair();
  const operatorKey = generateEdKeyPair();
  const leadKey = generateEdKeyPair();
  const researcherKey = generateEdKeyPair();
  const signers = new Map([
    ["crew-operator", operatorKey],
    ["crew-lead", leadKey],
    ["crew-researcher", researcherKey],
  ]);

  const trail = new ReceiptTrail(trailPath, issuer, `accountable-crew-mozaik/${runId}`);
  const state = new CrewState({
    ledger: new MandateLedger((rec) => {
      state.emitAction({ ...rec }, rec.caller_agent_id);
    }),
    trail,
    signers,
  });
  // The ledger callback above closes over `state` before it is assigned;
  // it only runs after construction, when `state` is initialized.
  const useDefaultRunner = process.env["ACCOUNTABLE_CREW_USE_DEFAULT_RUNNER"] === "1";
  if (useDefaultRunner) {
    initializeRuntime({ state });
  } else {
    initializeRuntime({ state, inferenceRunnerConfig: { runner: new ScriptedInferenceRunner() } });
  }
  joinRuntime(operator);
  joinRuntime(observer);
  joinRuntime(lead);
  joinRuntime(researcher);

  const leadId = state.actorId("lead");
  const researcherId = state.actorId("researcher");
  const operatorId = state.actorId("operator");
  const until = Math.floor(Date.now() / 1000) + 7200;

  state.emitAction(
    { action: "run.started", verdict: "RECORDED", job: JOB, lead_agent_id: leadId, researcher_agent_id: researcherId, provider: "scripted (deterministic, no model)" },
    operatorId,
  );
  stage("run", "STARTED", runId);

  // --- Mandates ------------------------------------------------------
  const root = issueMandate(leadId, ROOT_CAP, until);
  state.emitAction({ action: "mandate.issued", verdict: "RECORDED", holder_agent_id: leadId, cap_cents: ROOT_CAP, warrant_fingerprint: fingerprint(root) }, operatorId);
  const hop = delegate(root, researcherId, HOP_CAP, until);
  state.emitAction(
    { action: "mandate.delegated", verdict: "RECORDED", from_agent_id: leadId, to_agent_id: researcherId, cap_cents: HOP_CAP, warrant_fingerprint: fingerprint(hop) },
    operatorId,
  );
  stage("mandate", "OK", `root ${ROOT_CAP}c (lead) -> hop ${HOP_CAP}c (researcher)`);

  // --- Scenario 1: hire / price / pay / deliver ----------------------
  state.emitAction({ action: "hire.posted", verdict: "RECORDED", task_id: "task-demo-1", reward_cents_simulated: 5, poster_agent_id: leadId }, leadId);
  state.emitAction({ action: "hire.claimed", verdict: "RECORDED", task_id: "task-demo-1", worker_agent_id: researcherId }, researcherId);
  stage("hire", "OK", "task-demo-1 posted by lead, claimed by researcher");

  registerStep("research-price", {
    calls: [{ name: "fetch_price", args: { resource: "pcc-info" } }],
    answer: "Price fetched (scripted).",
    answerAfterTool: "The simulated price is 2 cents (scripted fetch_price result).",
  });
  registerStep("research-pay", {
    calls: [{ name: "pay_for_research", args: { warrant: hop, caller_agent_id: researcherId, cost_cents: 2, task: "pcc-info lookup (simulated)" } }],
    answer: "Pay step (scripted).",
    answerAfterTool: "Simulated payment of 2 cents was allowed under the 40c hop mandate; see the gate ALLOW receipt in the trail (scripted).",
  });
  registerStep("research-deliver", {
    calls: [{ name: "deliver_result", args: { task: "task-demo-1", result_text: "Simulated price: 2 cents, paid under mandate (simulated)." } }],
    answer: "Delivery step (scripted).",
    answerAfterTool: "Result delivered (scripted).",
  });
  let mark = state.observerLog.length;
  sendMessage("STEP:research-price Fetch the simulated price.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  mark = state.observerLog.length;
  sendMessage("STEP:research-pay Pay 2 simulated cents under the hop mandate.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  mark = state.observerLog.length;
  sendMessage("STEP:research-deliver Deliver the result.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  stage("scenario-1", "OK", "hire -> price -> pay 2c ALLOW -> deliver");

  // --- Scenario 2: overspend blocked ---------------------------------
  registerStep("research-overspend", {
    calls: [{ name: "pay_for_research", args: { warrant: hop, caller_agent_id: researcherId, cost_cents: 50, task: "overspend attempt (simulated)" } }],
    answer: "Overspend step (scripted).",
    answerAfterTool: "The 50-cent spend was denied: it exceeds the 40c hop cap (scripted denial; nothing was booked or executed).",
  });
  const hop2 = delegate(root, researcherId, HOP_CAP, until - 60);
  registerStep("research-cumulative-a", {
    calls: [{ name: "pay_for_research", args: { warrant: hop2, caller_agent_id: researcherId, cost_cents: 25, task: "cumulative part A (simulated)" } }],
    answer: "Cumulative A (scripted).",
    answerAfterTool: "25 cents allowed under the fresh 40c mandate (scripted).",
  });
  registerStep("research-cumulative-b", {
    calls: [{ name: "pay_for_research", args: { warrant: hop2, caller_agent_id: researcherId, cost_cents: 25, task: "cumulative part B (simulated)" } }],
    answer: "Cumulative B (scripted).",
    answerAfterTool: "The second 25 cents was denied: 25c already spent + 25c exceeds the 40c cap cumulatively, even though 25c alone would fit (scripted).",
  });
  mark = state.observerLog.length;
  sendMessage("STEP:research-overspend Attempt a 50-cent spend against the 40c hop.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  mark = state.observerLog.length;
  sendMessage("STEP:research-cumulative-a Spend 25 cents under a fresh 40c mandate.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  mark = state.observerLog.length;
  sendMessage("STEP:research-cumulative-b Spend another 25 cents under the same mandate.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  stage("scenario-2", "OK", "50c denied; 25c allowed then 25c denied cumulatively; denied spends not booked");

  // --- Scenario 3: tamper + anonymous --------------------------------
  let widenThrew = false;
  try {
    delegate(hop, researcherId, 90, until);
  } catch (e) {
    widenThrew = e instanceof WarrantError && e.message === "warrant_widen_cents";
  }
  if (!widenThrew) throw new Error("widening delegate() did not throw warrant_widen_cents");
  state.emitAction(
    { action: "tamper.refused", verdict: "RECORDED", detail: "delegate() widening 40c -> 90c threw WarrantError warrant_widen_cents", warrant_fingerprint: fingerprint(hop) },
    operatorId,
  );
  stage("tamper-delegate", "OK", "widening 40c -> 90c threw WarrantError (tamper signal)");

  const tampered: Warrant = JSON.parse(JSON.stringify(hop)) as Warrant;
  // Widened past the 100c root: the chain no longer narrows, so
  // structural verification fails (a 40c -> 90c edit would still
  // narrow under the root and would verify — the refusal here is
  // the chain-widening check, as in the Python port).
  tampered.hops[0]!.max_cents = 101;
  registerStep("research-tampered", {
    calls: [{ name: "pay_for_research", args: { warrant: tampered, caller_agent_id: researcherId, cost_cents: 2, task: "tampered warrant attempt (simulated)" } }],
    answer: "Tampered step (scripted).",
    answerAfterTool: "The tampered warrant was refused: its hop widens the cap, so verification fails (scripted denial).",
  });
  registerStep("research-anon", {
    calls: [{ name: "pay_for_research", args: { warrant: hop, caller_agent_id: "anonymous-seat", cost_cents: 2, task: "anonymous attempt (simulated)" } }],
    answer: "Anonymous step (scripted).",
    answerAfterTool: "The anonymous spend was denied: the warrant names the researcher, not anonymous-seat (scripted denial).",
  });
  mark = state.observerLog.length;
  sendMessage("STEP:research-tampered Spend with a widened (tampered) warrant.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  mark = state.observerLog.length;
  sendMessage("STEP:research-anon Spend as an anonymous seat with no mandate.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  stage("scenario-3", "OK", "tampered warrant refused; anonymous seat rejected");

  // --- False payment claim: model_message interception --------------
  registerStep("research-falseclaim", {
    answer: "Payment of 99 cents completed and settled.",
  });
  mark = state.observerLog.length;
  sendMessage("STEP:research-falseclaim Report the payment status.", operator.getId());
  await waitForAnswer(state, "Crew Researcher", mark);
  const claimBlocked = state.observerLog.slice(mark).some((e) => e.event === "interception.payment-claim-blocked");
  if (!claimBlocked) throw new Error("payment-claim interception did not fire for the false claim");
  stage("false-claim", "OK", "model answer claiming a payment with no ALLOW receipt was blocked and corrected");

  // --- Concurrency: two loops, genuinely overlapping ------------------
  const root2 = issueMandate(leadId, 100, until);
  const hopConc = delegate(root2, researcherId, 60, until);
  registerStep("lead-pay", {
    calls: [{ name: "pay_for_research", args: { warrant: root2, caller_agent_id: leadId, cost_cents: 10, task: "lead concurrent spend (simulated)" } }],
    answer: "Lead pay (scripted).",
    answerAfterTool: "Lead simulated spend of 10 cents allowed (scripted).",
  });
  registerStep("research-pay2", {
    calls: [{ name: "pay_for_research", args: { warrant: hopConc, caller_agent_id: researcherId, cost_cents: 15, task: "researcher concurrent spend (simulated)" } }],
    answer: "Researcher pay (scripted).",
    answerAfterTool: "Researcher simulated spend of 15 cents allowed (scripted).",
  });
  const concMark = state.observerLog.length;
  // Fire-and-forget: both messages sent with NO await between them.
  sendMessage("STEP:lead-pay Lead: spend 10 simulated cents under your mandate.", operator.getId());
  sendMessage("STEP:research-pay2 Researcher: spend 15 simulated cents under your mandate.", operator.getId());
  await waitUntil(
    () =>
      state.observerLog.slice(concMark).filter((e) => e.event === "model.answer" && e.producer === "Crew Lead").length >= 1 &&
      state.observerLog.slice(concMark).filter((e) => e.event === "model.answer" && e.producer === "Crew Researcher").length >= 1,
    8000,
    "both concurrent answers",
  );
  const concWindow = state.observerLog.slice(concMark);
  const loopIds = new Set(concWindow.map((e) => /"loopId":"([^"]+)"/.exec(e.detail)?.[1]).filter(Boolean));
  stage("concurrency", "OK", `both loops completed; distinct loopIds observed in window: ${loopIds.size}; events in window: ${concWindow.length}`);

  // --- Finish + verify -------------------------------------------------
  state.emitAction({ action: "run.finished", verdict: "RECORDED", payment_status: "simulated-only", note: "No real payment was made in this run." }, operatorId);
  const results = verifyTrail(trailPath, issuer.pubkeyHex);
  const bad = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`    verify line ${r.line}: ${r.ok ? "OK" : `FAIL ${r.error}: ${r.detail}`} ${r.verdict ? `(${r.verdict})` : ""}`);
  }
  stage("verify", bad.length === 0 ? "OK" : "FAIL", `${results.length - bad.length}/${results.length} receipts verified`);

  const records = trail.recordsSince(0);
  const decisions = records.filter((r) => r["action"] === "gate.decision");
  const allows = decisions.filter((r) => r["verdict"] === "ALLOW").length;
  const denies = decisions.filter((r) => r["verdict"] === "DENY").length;
  const spentHop = state.ledger.spentCents(hop);
  const spentHop2 = state.ledger.spentCents(hop2);
  const spentRoot2 = state.ledger.spentCents(root2);
  const spentHopConc = state.ledger.spentCents(hopConc);
  console.log(`\nsummary: records=${records.length} gateDecisions=${decisions.length} (ALLOW=${allows} DENY=${denies}) spent: hop1=${spentHop}c hop2=${spentHop2}c root2=${spentRoot2}c hopConc=${spentHopConc}c loopIdsInConcurrencyWindow=${loopIds.size}`);
  console.log(`trail: ${trailPath}`);
  console.log(`issuer pubkey: ${issuer.pubkeyHex}`);

  writeFileSync(join(runDir, "transcript.log"), state.observerLog.map((e) => `${e.at} ${e.event} <${e.producer}> ${e.detail}`).join("\n") + "\n");
  writeFileSync(
    join(runDir, "issuer.json"),
    JSON.stringify({ audit_id: `accountable-crew-mozaik/${runId}`, issuer_pubkey: issuer.pubkeyHex, trail_sha256: sha256OfFile(trailPath), trail_lines: results.length }, null, 2) + "\n",
  );

  const expected = { records: 17, allows: 4, denies: 4, spentHop: 2, spentHop2: 25, spentRoot2: 10, spentHopConc: 15 };
  const ok =
    bad.length === 0 &&
    records.length === expected.records &&
    allows === expected.allows &&
    denies === expected.denies &&
    spentHop === expected.spentHop &&
    spentHop2 === expected.spentHop2 &&
    spentRoot2 === expected.spentRoot2 &&
    spentHopConc === expected.spentHopConc &&
    loopIds.size >= 1;
  if (!ok) {
    console.log(`EXPECTED: ${JSON.stringify(expected)} — mismatch, failing run.`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
