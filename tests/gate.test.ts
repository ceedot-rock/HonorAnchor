import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MandateLedger,
  WarrantError,
  delegate,
  fingerprint,
  gateCheck,
  issueMandate,
  verifyWarrant,
} from "../src/mandate-gate.js";

const NOW = 1_700_000_000;
const UNTIL = NOW + 7200;

test("single-call cap: cost equal to cap allows, cost above denies OVER_BUDGET", () => {
  const w = issueMandate("agent-a", 40, UNTIL);
  assert.equal(gateCheck(w, "agent-a", 40, NOW).ok, true);
  const denied = gateCheck(w, "agent-a", 41, NOW);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "OVER_BUDGET");
});

test("cumulative overflow: two spends that each fit alone deny the second", () => {
  const ledger = new MandateLedger();
  const w = issueMandate("agent-a", 40, UNTIL);
  assert.equal(ledger.gatePayment(w, "agent-a", 25, NOW).ok, true);
  const second = ledger.gatePayment(w, "agent-a", 25, NOW);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, "OVER_BUDGET");
  assert.equal(ledger.spentCents(w), 25);
});

test("expired warrant denies WARRANT_EXPIRED", () => {
  const w = issueMandate("agent-a", 40, UNTIL);
  const d = gateCheck(w, "agent-a", 1, UNTIL);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "WARRANT_EXPIRED");
  assert.equal(verifyWarrant(w, UNTIL).ok, false);
});

test("agent mismatch denies AGENT_MISMATCH", () => {
  const w = issueMandate("agent-a", 40, UNTIL);
  const d = gateCheck(w, "someone-else", 1, NOW);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "AGENT_MISMATCH");
});

test("attenuation narrows only: widening cents or until throws WarrantError", () => {
  const root = issueMandate("lead", 100, UNTIL);
  assert.throws(() => delegate(root, "worker", 101, UNTIL), (e: unknown) => e instanceof WarrantError && e.message === "warrant_widen_cents");
  assert.throws(() => delegate(root, "worker", 40, UNTIL + 1), (e: unknown) => e instanceof WarrantError && e.message === "warrant_widen_until");
  const hop = delegate(root, "worker", 40, UNTIL);
  assert.equal(hop.hops.length, 1);
  const hop2 = delegate(hop, "worker2", 15, UNTIL);
  assert.equal(hop2.hops.length, 2);
  // Tampered doc: hop widened past the 100c root fails verification.
  const tampered = JSON.parse(JSON.stringify(hop)) as typeof hop;
  tampered.hops[0]!.max_cents = 101;
  assert.equal(verifyWarrant(tampered, NOW).ok, false);
});

test("denied spends are never booked; allow and deny both reach onDecision", () => {
  const seen: string[] = [];
  const ledger = new MandateLedger((rec) => seen.push(rec.verdict));
  const w = issueMandate("agent-a", 40, UNTIL);
  assert.equal(ledger.gatePayment(w, "agent-a", 40, NOW).ok, true);
  assert.equal(ledger.gatePayment(w, "agent-a", 1, NOW).ok, false);
  assert.equal(ledger.spentCents(w), 40);
  assert.deepEqual(seen, ["ALLOW", "DENY"]);
});

test("fingerprint is stable and changes with the document", () => {
  const a = issueMandate("agent-a", 40, UNTIL);
  const b = issueMandate("agent-a", 40, UNTIL);
  const c = issueMandate("agent-a", 41, UNTIL);
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
  assert.match(fingerprint(a), /^[0-9a-f]{16}$/);
});

test("invalid cost and malformed warrant deny by default", () => {
  const w = issueMandate("agent-a", 40, UNTIL);
  assert.equal(gateCheck(w, "agent-a", -1, NOW).ok, false);
  assert.equal(gateCheck(w, "agent-a", 1.5, NOW).ok, false);
  const d = gateCheck({ v: 2, kind: "other" }, "agent-a", 1, NOW);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "WARRANT_DENIED");
});

test("previewGate does not book and agrees with the booking gate", () => {
  const ledger = new MandateLedger();
  const w = issueMandate("agent-a", 40, UNTIL);
  assert.equal(ledger.previewGate(w, "agent-a", 40, NOW).ok, true);
  assert.equal(ledger.spentCents(w), 0);
  assert.equal(ledger.gatePayment(w, "agent-a", 40, NOW).ok, true);
  assert.equal(ledger.previewGate(w, "agent-a", 1, NOW).ok, false);
  assert.equal(ledger.spentCents(w), 40);
});
