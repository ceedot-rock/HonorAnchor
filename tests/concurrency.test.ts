import assert from "node:assert/strict";
import { test } from "node:test";
import { MandateLedger, issueMandate } from "../src/mandate-gate.js";

test("concurrent gate calls: exactly cap-many allow, spent never exceeds cap", async () => {
  const ledger = new MandateLedger();
  const w = issueMandate("agent-a", 10, 1_900_000_000);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => Promise.resolve().then(() => ledger.gatePayment(w, "agent-a", 1, 1_700_000_000))),
  );
  const allows = results.filter((r) => r.ok).length;
  const denies = results.filter((r) => !r.ok).length;
  assert.equal(allows, 10);
  assert.equal(denies, 10);
  assert.equal(ledger.spentCents(w), 10);
});

test("separate warrant documents have separate ledger accounts", () => {
  const ledger = new MandateLedger();
  const a = issueMandate("agent-a", 10, 1_900_000_000);
  const b = issueMandate("agent-a", 10, 1_900_000_000 - 60);
  assert.equal(ledger.gatePayment(a, "agent-a", 10, 1_700_000_000).ok, true);
  assert.equal(ledger.gatePayment(b, "agent-a", 10, 1_700_000_000).ok, true);
  assert.equal(ledger.spentCents(a), 10);
  assert.equal(ledger.spentCents(b), 10);
});
