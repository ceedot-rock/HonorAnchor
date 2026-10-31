import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReceiptTrail, generateEdKeyPair, verifyTrail } from "../src/receipts.js";
import { canonicalJson } from "../src/canonical.js";

function freshTrail() {
  const dir = mkdtempSync(join(tmpdir(), "crew-trail-"));
  const issuer = generateEdKeyPair();
  const trail = new ReceiptTrail(join(dir, "trail.jsonl"), issuer, "test/audit");
  return { dir, issuer, trail };
}

test("emit + verify: all lines verify with issuer pubkey only", () => {
  const { trail, issuer } = freshTrail();
  const seat = generateEdKeyPair();
  trail.emit({ action: "test.action", verdict: "RECORDED", detail: "hello" }, seat);
  trail.emit({ action: "test.action", verdict: "ALLOW", detail: "world" }, seat);
  const results = verifyTrail(trail.trailPath, issuer.pubkeyHex);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
});

test("tampering with a record breaks the inner signature", () => {
  const { trail, issuer } = freshTrail();
  const seat = generateEdKeyPair();
  trail.emit({ action: "test.action", verdict: "RECORDED", amount_cents: 2 }, seat);
  const lines = readFileSync(trail.trailPath, "utf8").trim().split("\n");
  const env = JSON.parse(lines[0]!) as { record: Record<string, unknown> };
  env.record["amount_cents"] = 99;
  writeFileSync(trail.trailPath, JSON.stringify(env) + "\n");
  const results = verifyTrail(trail.trailPath, issuer.pubkeyHex);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.ok, false);
  assert.equal(results[0]!.error, "INNER_SIGNATURE_INVALID");
});

test("tampering with meta breaks the outer (issuer) signature", () => {
  const { trail, issuer } = freshTrail();
  const seat = generateEdKeyPair();
  trail.emit({ action: "test.action", verdict: "RECORDED" }, seat);
  const lines = readFileSync(trail.trailPath, "utf8").trim().split("\n");
  const env = JSON.parse(lines[0]!) as { meta: { property: string } };
  env.meta.property = "forged property";
  writeFileSync(trail.trailPath, JSON.stringify(env) + "\n");
  const results = verifyTrail(trail.trailPath, issuer.pubkeyHex);
  assert.equal(results[0]!.ok, false);
  assert.equal(results[0]!.error, "OUTER_SIGNATURE_INVALID");
});

test("wrong issuer pubkey is reported as issuer mismatch, not as valid", () => {
  const { trail } = freshTrail();
  const seat = generateEdKeyPair();
  const other = generateEdKeyPair();
  trail.emit({ action: "test.action", verdict: "RECORDED" }, seat);
  const results = verifyTrail(trail.trailPath, other.pubkeyHex);
  assert.equal(results[0]!.ok, false);
  assert.equal(results[0]!.error, "ISSUER_MISMATCH");
});

test("missing trail file is a result, not a crash", () => {
  const results = verifyTrail("/tmp/definitely-not-a-trail-12345.jsonl");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.error, "TRAIL_MISSING");
});

test("canonical JSON rejects floats and is key-order independent", () => {
  assert.throws(() => canonicalJson({ a: 1.5 }), /non-integer/);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalJson({ a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4}}');
});
