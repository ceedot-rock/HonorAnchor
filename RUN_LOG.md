# Run log — Accountable Crew on Mozaik (Novi Sad Freestyle)

Dated entries, written at the time each run/measurement/decision/failure happens.
Standing rule: a measurement with no record does not exist.

## 2026-10-30 — Tavily research pass (BEFORE building)

- 6 basic-depth searches via custom.tavily helper (1 credit each, 6 total):
  1. "Mozaik v4 defineRuntime InterceptionHandler model_message" (5 results)
  2. "Mozaik AI concurrent agents runLoop RuntimeState" (5 results)
  3. "TypeScript Ed25519 signed audit trail canonical JSON append-only log" (5 results)
  4. "jigjoy Mozaik v4 createAgent createHuman RuntimeState SituationHandler docs" (5 results)
  5-6. Queries 1-2 re-run to capture full JSON for pedia filing (first run output was truncated in the terminal).
- Filed FIRST to the Slidphiclepedia: pulls.jsonl 619 -> 639 lines (20 pulls),
  grouped index.md section "Novi Sad Freestyle — Mozaik v4 + signed receipt
  trails — 2026-10-30 (20 pulls)". Pedia files left uncommitted WIP.
- Honest assessment: Tavily results were mostly off-target (unrelated
  "Mozaik" companies, Runloop funding news). The ONE useful pull was the
  jigjoy-ai/mozaik README snippet confirming: runLoop is fire-and-forget,
  each invocation gets a unique loopId, concurrent agents do not share a
  cursor, and InterceptionHandler inspects/rewrites a loop transition.
  Primary grounding for the build is therefore the docs + examples repos
  and the shipped .d.ts, read first-hand — not Tavily snippets.

## 2026-10-30 — Mozaik examples grounding (cloned, read)

- `git clone --depth 1 https://github.com/jigjoy-ai/mozaik-examples`
  into vendor/mozaik-examples, HEAD 046ef8c431a6eaafea6c7765c6733f4baf4d3a86,
  @mozaik-ai/core 4.2.0, Node 18+.
- Studied: inference-interception/ (defineRuntime + RuntimeState subclass,
  createAgent + handlers, SituationHandler message.sent -> runLoop with
  SafetyInterceptionHandler on model_message, loop back to message_received),
  custom-inference-runner/ (InferenceRunner run()+stream(), wired via
  initializeRuntime inferenceRunnerConfig + supportedModels + Mock runner),
  shared-state/ (RuntimeState subclass holding shared FreemiumAccount;
  specification reads resolveRuntime().state and can throw/deny),
  human-in-the-loop/ (ApprovalInterceptionHandler on nextStateId
  "function_call": approve -> return transition unchanged; reject ->
  FunctionCallOutputItem + return nextStateId "inference"),
  tool-calling/ (Tool shape: type/function, parameters JSON schema,
  invoke(args)).

## 2026-10-30 — Spike: shipped .d.ts for @mozaik-ai/core 4.2.0 (read in full, 637 lines)

- LoopStateId = "message_received" | "inference" | "inference_streaming"
  | "function_call" | "model_message" | "idle".
  ExecutableLoopStateId = LoopStateId minus "idle". The LoopStateContract
  also lists an "interception" entry, but it is NOT a member of
  LoopStateId, so a handler must return one of the six LoopStateIds
  (in practice one of the five executable ones, as the examples do:
  "message_received" and "inference").
- ExecutableTransition inputs per state: message_received ->
  {content: string, input: InferenceInput}; inference/inference_streaming ->
  InferenceInput; function_call -> {call: FunctionCallItem,
  inferenceInput: InferenceInput}; model_message -> {answer:
  ModelMessageItem}.
- InterceptionHandler = {isSatisfiedBy(transition): boolean,
  handle(transition): Promise<ExecutableTransition>}.
- Tool = FunctionTool {type: "function", name, description, parameters,
  strict: boolean, invoke: (args: any) => Promise<any>}. invoke receives
  ONLY args — no callId. Consequence recorded for the design: the
  interception handler cannot pass a pre-approval token into invoke();
  the handler therefore does a non-booking preview check, and invoke()
  performs the real (booking) gate. See src/mandate-gate.ts previewGate.
- InferenceRunner = {run(input): Promise<InferenceOutput>, stream(input):
  AsyncGenerator<SemanticEvent>}. InferenceOutput = {items:
  (FunctionCallItem|ReasoningItem|ModelMessageItem)[], tokenUsage,
  rowResponse}. InferenceInput = {model, maxOutputTokens?,
  reasoningEffort?, tools?, streaming?, structuredOutput?, context:
  ModelContext}.
- runLoop(agentId, message, inferenceInput, interceptionHandler?) returns
  void — fire-and-forget, confirmed by the type and by spike v2.
- createAgent/createHuman take {name, capabilities, instruction (agents
  only), tools, handlers}. defineRuntime() returns {initializeRuntime,
  resolveRuntime, resolveParticipant, join, leave, sendMessage,
  sendEvent, runLoop}. initializeRuntime takes {state,
  inferenceRunnerConfig?: {supportedModels?, runner?}}.
- FunctionCallItem.args is a JSON STRING. FunctionCallOutputItem.create
  (callId, outputString). ModelMessageItem.rehydrate({text}),
  content: OutputText {text}. ModelContext.getItems()/addContextItems().
- CONCLUSION: a tool-call interception state EXISTS ("function_call").
  The enforcement point is BOTH the function_call interception (preview,
  visible) AND the tool invoke() (booking gate) — neither alone is the
  whole story, and the code/README must say so.

## 2026-10-30 — Spike v1 (FAILED, instructive): naive deterministic runner loops forever

- Minimal program: custom runner returns FunctionCallItem whenever the
  last user message contains "TOOL:echo"; interception handler blocks
  every function_call by returning an "inference" transition with a
  denial output appended. Result: infinite loop (30s timeout, ~4MB of
  repeated log lines). Cause: the runner re-derived the same call from
  the original user message and ignored the appended FunctionCallOutput.
  A real model would see the denial output and change course; a scripted
  runner must do the same. RULE ADOPTED: the scripted runner decides
  from the TAIL of the context — a trailing FunctionCallOutputItem means
  "answer with what the tool said", never "re-issue the call" — and
  interception handlers carry a once-per-instance guard (as the Safety
  example does with `intercepted`).

## 2026-10-30 — Spike v2 (PASSED): stateful scripted runner terminates

- Same harness, runner tail-aware + handler once-guard. Results:
  denied tool call = 2 runner invocations, plain answer = 1, process
  exited 0. Events observed: participant.joined, message.sent,
  message_received.started/completed, inference.started/completed,
  interception.started/finished, model.answer. Custom runner with model
  name "scripted-mock" and NO supportedModels entry works with
  initializeRuntime({inferenceRunnerConfig: {runner}}). Harmless line
  observed: "mozaik cloud: no API key — telemetry disabled" (no key
  needed; nothing sent).
- DECISION: demo uses a step-tag scripted runner (STEP:<tag> in the
  operator message selects the scripted step; trailing tool output
  selects the follow-up answer). Every receipt is labeled "scripted".

## 2026-10-30 — Build (src/, tests/)

- Wrote: canonical.ts (sorted-key canonical JSON, integer-only, SHA-256),
  mandate-gate.ts (faithful port incl. verify/gateCheck/ledger/previewGate),
  receipts.ts (Ed25519 inner+outer, JSONL, offline verify), tools.ts
  (invoke-time booking gate; state read lazily via resolveRuntime),
  runtime.ts (CrewState + defineRuntime), runner.ts (step-tag scripted
  runner, tail rule, 40ms simulated thinking delay), interception.ts
  (preview + payment-claim + combined), participants.ts (STEP-prefix
  processors, Observer logging all events), demo.ts, verify.ts.
- Design decision recorded: preview-vs-booking split exists because
  Tool.invoke receives ONLY args (no callId) — proven from the shipped
  .d.ts. The interception handler therefore previews without booking
  and receipts denials itself; invoke() books. Both layers share the
  one ledger, so a preview-allow can still be denied at booking.
- Inner-signature convention fixed during build: signing covers the
  record WITH signer_pubkey, WITHOUT signature (Python cuni_envelope
  convention). First verifier draft stripped signer_pubkey too and
  would have failed every line; caught by reasoning before the first
  run, confirmed by the tamper tests passing.

## 2026-10-30 — Test failures found and fixed (all in the record)

1. Receipts tamper test expected INNER_SIGNATURE_INVALID but got
   OUTER_SIGNATURE_INVALID: tampering a record breaks both signatures
   (outer covers the record). FIX: verify inner first (more specific
   diagnosis), outer second. Meta-tamper still reports OUTER.
2. Integration test: only 2 receipts instead of 3. Cause: the scripted
   runner's "already called" check scanned the agent's WHOLE accumulated
   memory, so a second step reusing pay_for_research never fired.
   FIX: only calls after the current step message count.
3. Gate attenuation test + demo tampered-warrant step: widening 40c to
   90c still narrows under the 100c root, so verification passes.
   FIX (test + demo): tampered hop set to 101c, past the root, so the
   chain-widening check fails. The delegate()-throw tamper signal was
   always correct and unchanged.

## 2026-10-30 — Tests: 18/18 pass, typecheck clean

- Command: `npm test` (tsx --test). Counts: gate 9, receipts 6,
  concurrency 2, interception 1 = 18 tests, 18 pass, 0 fail.
- `npx tsc --noEmit`: clean (no errors).
- Install: `npm install` in the project dir; @mozaik-ai/core pinned
  exactly 4.2.0 in package.json (lockfile present). Node v24.22.1,
  npm 10.9.4 on this VM (no pnpm, per task brief).

## 2026-10-30 — Demo run 1 (run-2026-10-30T190803Z): exit 0

- Command: `npm run demo`. Stages all OK; 17/17 receipts verified;
  gate decisions 4 ALLOW / 4 DENY; spent hop1=2c hop2=25c root2=10c
  hopConc=15c; concurrency window 2 loopIds, 20 events. (This run
  predates the false-claim step; see run 2.)

## 2026-10-30 — False-claim handler exercised (demo + test)

- Added STEP:research-falseclaim (scripted answer: "Payment of 99 cents
  completed and settled.") to demo.ts and a matching case to the
  integration test. The PaymentClaimHandler blocked it (no ALLOW
  receipt since loop start) and looped back with the correction; the
  corrected answer reached model.answer. Demo + tests re-run green.

## 2026-10-30 — Demo run 2 (run-2026-10-30T190839Z): exit 0 — THE RECORD RUN

- Command: `npm run demo`. Full stage output in /tmp/demo-run2.log
  (ephemeral). Stages: run STARTED; mandate OK; hire OK; scenario-1 OK;
  scenario-2 OK; tamper-delegate OK; scenario-3 OK; false-claim OK;
  concurrency OK (2 loopIds, 20 events); verify OK 17/17.
- Summary line (verbatim): records=17 gateDecisions=8 (ALLOW=4 DENY=4)
  spent: hop1=2c hop2=25c root2=10c hopConc=15c
  loopIdsInConcurrencyWindow=2.
- Issuer pubkey: d2c238bcd7a2231016a4f55ed6682df70e9eca522d9451c46d1299c39c731022
- Trail: runs/run-2026-10-30T190839Z/trail.jsonl (21,448 bytes),
  issuer.json + transcript.log (37,653 bytes) alongside.
- Independent re-verification: `npm run verify -- --trail
  runs/run-2026-10-30T190839Z/trail.jsonl --issuer-pubkey <above>`
  printed "17/17 verified", exit 0.
- Concurrency evidence (transcript.log lines 97-112): both
  inference.started events at 19:08:40.326Z (Lead + Researcher),
  Lead inference.completed 40.367Z while Researcher was still running
  (completed 40.371Z). Genuine overlap, not a sequential pipeline.
- Interception evidence: 4 interception.started/finished pairs in the
  observer log, all function_call denials (overspend, cumulative,
  tampered, anonymous). The false-claim model_message interception is
  recorded as event "interception.payment-claim-blocked" in the log.
- Harmless runtime line observed in every run: "mozaik cloud: no API
  key — telemetry disabled." No key is needed; nothing is sent.
- Boundaries kept: no git repo created; nothing published, submitted,
  booked, or posted. No key file written anywhere (keys in memory
  only). No Rider/Python key reused. No live rail touched (no MCP/x402
  calls in code or logs). No compression claims anywhere.
- Deliverables: README.md, SUBMISSION_CHECKLIST.md (Corey's dashboard
  fields left blank), RUN_LOG.md (this file). vendor/ kept: 2.0 MB
  shallow clone of mozaik-examples at 046ef8c (grounding only; the
  build imports nothing from it).
