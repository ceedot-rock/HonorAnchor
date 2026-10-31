# Accountable Crew on Mozaik

A TypeScript port of the Accountable Crew idea — agents that hire each
other under a spend mandate, with every spend gated and every action
receipted — onto the Mozaik v4 runtime (`@mozaik-ai/core` 4.2.0).

Submission title: **HonorAnchor** (Corey's call, 2026-10-31; replaces the
working title "Accountable Crew on Mozaik").

**Demo thesis:** "trust me" multi-agent demos become provable ones.
Two concurrent agents (Lead + Researcher) work a job under
Warrant-shaped spend mandates. Every simulated spend is checked by a
cumulative mandate gate before it executes; overspend, tampering, and
anonymous spending are blocked on camera; the whole run leaves a
signed receipt trail anyone can verify offline with one public key.

## What it is — and what it is not (read this first)

- **It IS:** a faithful port of the *idea and semantics* of
  `~/workspace/accountable-crew/` (Python) — mandate-gate deny codes,
  cumulative-spend ledger, attenuation-narrows-only, inner/outer
  signed check-kind receipts — reimplemented in TypeScript on Mozaik.
- **It is NOT the Python build.** No live Agent-Rider rail, no MCP
  calls, no x402/on-chain payment, no Zetaris, no real money. Spend is
  **simulated cents** against mandate caps. The receipt trail is a
  **signed receipt trail, CuNi-shaped check envelopes reimplemented in
  TypeScript — NOT the verified Python `cuni_envelope`**. Verification
  proves signature + canonical integrity only. Never claim CuNi
  equivalence, "12/12 CuNi", or any Python-run number for this build.
- **No compression claims of any kind** are made anywhere in this
  project. (The lab's C/C++ claims rule is therefore not triggered.)
- Inference is **scripted** (deterministic, labeled "scripted" in every
  receipt). The demo runs with **zero API keys**. A real-provider path
  exists but is opt-in only — see below.
- Keys are **fresh ephemeral Ed25519 key pairs generated in memory at
  runtime**. No key file is written, nothing is committed, and no key
  from `~/workspace/accountable-crew/.keys` (or any Rider key) is ever
  reused. Only the trail *issuer public key* is saved (in the run's
  `issuer.json`), which is what offline verification needs.

## How to run (zero keys)

```sh
npm install
npm test        # 18 tests
npm run demo    # full demo: 3 scenarios + concurrency + trail verify
```

Demo output lands in `runs/<runId>/`:

- `trail.jsonl` — the signed receipt trail (one JSON envelope per line)
- `issuer.json` — issuer public key + trail SHA-256 + line count
- `transcript.log` — the Observer's event log (loop interleaving visible)

Verify a trail offline, issuer pubkey only:

```sh
npm run verify -- --trail runs/<runId>/trail.jsonl --issuer-pubkey <hex from issuer.json>
```

Real-provider path (opt-in, never required): set
`ACCOUNTABLE_CREW_USE_DEFAULT_RUNNER=1` and provide a provider API key
in the environment (e.g. `OPENAI_API_KEY`) before `npm run demo`.
Mozaik's default provider-backed runner is then used instead of the
scripted runner. The scripted STEP scenarios do not run under it
(free-text model output is not step-tagged); the gate + trail
enforcement is identical either way, because it lives in the tools and
interception handlers, not in the runner.

## Architecture

```
operator (createHuman) ── STEP messages ──▶ Lead / Researcher (createAgent)
                                              │  concurrent runLoops
                                              ▼
                       ┌─────────────────────────────────────────┐
                       │ CrewState (shared RuntimeState)         │
                       │  MandateLedger  ·  ReceiptTrail (JSONL) │
                       │  signer keys    ·  observer log         │
                       └─────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┴──────────────────────────┐
                    │ enforcement (both layers, same ledger)           │
                    │  1. function_call interception: non-booking     │
                    │     preview; denied calls blocked + receipted    │
                    │  2. tool invoke(): booking gate BEFORE any      │
                    │     simulated execution; direct invokes gated    │
                    │     too                                          │
                    └──────────────────────────────────────────────────┘
                    ┌──────────────────────────────────────────────────┐
                    │ model_message interception: blocks an answer     │
                    │ claiming a payment with no ALLOW receipt since   │
                    │ the loop started; loops back with a correction.  │
                    │ Text-pattern guard only — the trail is the proof.│
                    └──────────────────────────────────────────────────┘
```

- `src/mandate-gate.ts` — Warrant port + `MandateLedger`. Deny codes
  verbatim: `WARRANT_DENIED | WARRANT_EXPIRED | OVER_BUDGET |
  AGENT_MISMATCH`. Fingerprint = SHA-256 of canonical JSON, first 16
  hex. Attenuation narrows only; widening throws `WarrantError`.
- `src/receipts.ts` — Ed25519 inner sign (acting participant) + outer
  issuer sign, canonical JSON (sorted keys, integer cents, no floats),
  append-only JSONL, offline `verifyTrail`.
- `src/tools.ts` — `pay_for_research` (gated), `fetch_price` (free),
  `deliver_result` (free). Tools read runtime state lazily at invoke
  time (the shared-state example pattern).
- `src/runner.ts` — scripted `InferenceRunner`. Step-tag driven; tail
  rule: a trailing tool output means "answer with what the tool said",
  never re-issue the call (see RUN_LOG.md, spike v1).
- `src/interception.ts` — `GatePreviewHandler`, `PaymentClaimHandler`,
  `CombinedInterceptionHandler` (runLoop takes one handler).
- `src/participants.ts` — operator, Lead, Researcher, Observer. Each
  agent reacts only to its own `STEP:` prefix.
- `src/demo.ts` — the demo driver. `src/verify.ts` — verify CLI.

## Demo transcript (real run, 2026-10-30)

Run `runs/run-2026-10-30T190839Z`, exit 0. Numbers below come from that
run's own output (see RUN_LOG.md) — no other run's numbers are quoted.

- Scenario 1: hire → price (2c) → pay 2c **ALLOW** → deliver.
- Scenario 2: 50c spend **denied** (over 40c hop); fresh 40c mandate:
  25c **ALLOW**, then 25c **denied OVER_BUDGET cumulatively**
  (25c spent + 25c > 40c); denied spends never booked.
- Scenario 3: widening `delegate()` 40c → 90c threw `WarrantError`
  (`warrant_widen_cents`); tampered warrant (hop widened past the 100c
  root) refused; anonymous seat rejected (`AGENT_MISMATCH`).
- False claim: a scripted answer claiming "Payment of 99 cents
  completed" with no ALLOW receipt was blocked by the
  `model_message` handler and corrected.
- Concurrency: Lead (10c) and Researcher (15c) loops sent with no
  await between them — transcript shows both `inference.started` at
  19:08:40.326Z, overlapping completions, 2 distinct loopIds in the
  window.
- Trail: **17/17 receipts verified** offline (issuer pubkey only).
  Gate decisions: **4 ALLOW / 4 DENY**. Cumulative spent: hop1 2c,
  hop2 25c, root2 10c, hopConc 15c.
- Tests: **18/18 pass** (`npm test`), `tsc --noEmit` clean.
- No git repo was created for this project. Nothing was published,
  submitted, or posted. Publishing/submitting is Corey's decision.

## Boundaries (verbatim, for the submission)

NO live Agent-Rider rail, NO MCP calls, NO x402/on-chain payment, NO
Zetaris, NO real money. Spend is simulated cents against mandate
caps. Fresh ephemeral demo keys only, generated at runtime, never
committed. No secrets in code, no `.env` committed. Every number in
this README comes from a run actually executed and recorded in
`RUN_LOG.md` at the time it happened.

## Sources grounded in

- Mozaik docs homepage (docs.jigjoy.ai) + `jigjoy-ai/mozaik-examples`
  at commit `046ef8c` (vendored shallow clone in `vendor/`, read
  first-hand) + the shipped `@mozaik-ai/core@4.2.0` `.d.ts` (read in
  full; enumerated loop states recorded in RUN_LOG.md).
- Tavily best-methods pass (6 basic searches, 20 pulls filed to the
  Slidphiclepedia first — mostly off-target; grounding is the docs,
  examples, and types, not the snippets).

## Visual demo
`demo.html` replays the recorded run `run-2026-10-31T103002Z` (17 receipts, 17/17 verified) with play/step/speed controls — open it directly in a browser, no server needed.
Honesty lines are on the page: simulated cents, scripted inference, receipts prove signature + canonical integrity only (not verified CuNi).
