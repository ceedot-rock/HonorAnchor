/**
 * receipts.ts — signed receipt trail, TypeScript reimplementation in the
 * SHAPE of the Python CuNi check-kind envelopes (inner-signed action
 * record + outer issuer signature, append-only JSONL, offline verify).
 *
 * NAME IT ACCURATELY: this is NOT the verified Python cuni_envelope
 * (~/workspace/fabric-phase1/builds/receipts/cuni_envelope.py, corpus
 * 20/20, milestone 12/12). It reimplements the same two-key idea with
 * Node's Ed25519 and the canonical JSON in src/canonical.ts.
 * Verification here proves signature + canonical integrity only. NEVER
 * claim CuNi equivalence, "12/12 CuNi", or any Python-run number for
 * this TypeScript build.
 *
 * - Every action record is inner-signed by the acting participant's own
 *   fresh ephemeral Ed25519 key (generated in memory at runtime; no key
 *   file is ever written). The trail issuer key outer-signs the whole
 *   envelope. Two keys, two claims: the seat attests "I did this", the
 *   issuer attests "this record is in the trail".
 * - Envelope: {seq, kind: "check", record, meta, issuer_pubkey,
 *   issuer_signature}. Inner signature covers the canonical bytes of
 *   the record WITHOUT signer_pubkey/signature. Outer signature covers
 *   the canonical bytes of {seq, kind, record, meta}.
 * - No floats anywhere: canonicalJson throws on non-integer numbers.
 * - verifyTrail is offline (issuer pubkey only) and never throws: a bad
 *   line becomes {ok: false, ...}.
 */
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson } from "./canonical.js";

export const RECEIPT_KIND = "check";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface EdKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  pubkeyHex: string;
}

export function generateEdKeyPair(): EdKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const pubkeyHex = spki.subarray(spki.length - 32).toString("hex");
  return { privateKey, publicKey, pubkeyHex };
}

export function publicKeyFromHex(pubkeyHex: string): KeyObject {
  const raw = Buffer.from(pubkeyHex, "hex");
  if (raw.length !== 32) throw new Error("pubkey must be 32 bytes (64 hex chars)");
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
}

function signBytes(priv: KeyObject, data: string): string {
  return sign(null, Buffer.from(data, "utf8"), priv).toString("hex");
}

function verifyBytes(pub: KeyObject, data: string, signatureHex: string): boolean {
  try {
    return verify(null, Buffer.from(data, "utf8"), pub, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export type ActionRecord = Record<string, string | number | boolean | null | unknown[]> & {
  action: string;
  verdict: string;
};

export interface EnvelopeMeta {
  audit_id: string;
  issued_at: string;
  issuer: { display_name: string };
  property: string;
}

export interface Envelope {
  seq: number;
  kind: string;
  record: Record<string, unknown>;
  meta: EnvelopeMeta;
  issuer_pubkey: string;
  issuer_signature: string;
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function signAction(action: ActionRecord, signer: EdKeyPair): Record<string, unknown> {
  const inner: Record<string, unknown> = { ...action };
  inner["signer_pubkey"] = signer.pubkeyHex;
  const bytes = canonicalJson(inner);
  inner["signature"] = signBytes(signer.privateKey, bytes);
  return inner;
}

export class ReceiptTrail {
  readonly trailPath: string;
  readonly issuerPubkeyHex: string;
  private issuer: EdKeyPair;
  private seq = 0;
  private readonly auditId: string;
  /** In-memory copy of emitted records (seq + unsigned record fields). */
  private readonly emitted: Array<Record<string, unknown>> = [];

  constructor(trailPath: string, issuer: EdKeyPair, auditId: string) {
    this.trailPath = trailPath;
    this.issuer = issuer;
    this.issuerPubkeyHex = issuer.pubkeyHex;
    this.auditId = auditId;
    mkdirSync(dirname(trailPath), { recursive: true });
    if (existsSync(trailPath)) {
      this.seq = readFileSync(trailPath, "utf8").split("\n").filter((l) => l.trim() !== "").length;
    }
  }

  emit(action: ActionRecord, signer: EdKeyPair): Envelope {
    this.seq += 1;
    const record = signAction({ seq: this.seq, ...action }, signer);
    const meta: EnvelopeMeta = {
      audit_id: this.auditId,
      issued_at: utcNow(),
      issuer: { display_name: "Accountable Crew on Mozaik trail issuer (TypeScript reimplementation)" },
      property:
        "Accountability: every cross-agent action in this trail was performed by a named Mozaik participant, checked against a Warrant-shaped spend mandate before any simulated spend, and is tamper-evident after the fact. Signed receipt trail, CuNi-shaped check envelopes reimplemented in TypeScript — NOT the verified Python cuni_envelope.",
    };
    const outerBytes = canonicalJson({ seq: this.seq, kind: RECEIPT_KIND, record, meta });
    const env: Envelope = {
      seq: this.seq,
      kind: RECEIPT_KIND,
      record,
      meta,
      issuer_pubkey: this.issuerPubkeyHex,
      issuer_signature: signBytes(this.issuer.privateKey, outerBytes),
    };
    appendFileSync(this.trailPath, JSON.stringify(env) + "\n", "utf8");
    this.emitted.push({ seq: this.seq, ...record });
    return env;
  }

  /** Number of envelopes emitted so far in this process. */
  get seqCount(): number {
    return this.seq;
  }

  /** Records emitted with seq strictly greater than `seq` (in-memory). */
  recordsSince(seq: number): Array<Record<string, unknown>> {
    return this.emitted.filter((r) => typeof r["seq"] === "number" && (r["seq"] as number) > seq);
  }
}

export interface VerifyLineResult {
  line: number;
  ok: boolean;
  verdict?: string;
  error?: string;
  detail?: string;
}

/**
 * Verify every envelope in a trail offline, issuer pubkey only.
 * One result per line; never throws.
 */
export function verifyTrail(path: string, issuerPubkeyHex?: string): VerifyLineResult[] {
  if (!existsSync(path)) {
    return [{ line: 0, ok: false, error: "TRAIL_MISSING", detail: `no trail file at ${path}` }];
  }
  const results: VerifyLineResult[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  let lineNo = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    lineNo += 1;
    try {
      const env = JSON.parse(line) as Envelope;
      if (env.kind !== RECEIPT_KIND) throw new Error("bad kind");
      if (typeof env.seq !== "number" || !Number.isInteger(env.seq)) throw new Error("bad seq");
      const expectedIssuer = issuerPubkeyHex ?? env.issuer_pubkey;
      if (env.issuer_pubkey !== expectedIssuer) {
        results.push({ line: lineNo, ok: false, error: "ISSUER_MISMATCH", detail: "envelope issuer pubkey does not match the expected issuer pubkey" });
        continue;
      }
      const outerBytes = canonicalJson({ seq: env.seq, kind: env.kind, record: env.record, meta: env.meta });
      const issuerPub = publicKeyFromHex(env.issuer_pubkey);
      const record = env.record;
      const signature = record["signature"];
      const signerPubkey = record["signer_pubkey"];
      if (typeof signature !== "string" || typeof signerPubkey !== "string") {
        results.push({ line: lineNo, ok: false, error: "INNER_SIGNATURE_MISSING", detail: "record lacks signer_pubkey/signature" });
        continue;
      }
      // Inner first: a tampered record breaks BOTH signatures (the
      // outer covers the record), and the inner failure is the more
      // specific diagnosis. A tampered meta leaves the inner valid
      // and is caught by the outer check below.
      const { signature: _s, ...unsigned } = record;
      void _s;
      const innerBytes = canonicalJson(unsigned);
      const signerPub = publicKeyFromHex(signerPubkey);
      if (!verifyBytes(signerPub, innerBytes, signature)) {
        results.push({ line: lineNo, ok: false, error: "INNER_SIGNATURE_INVALID", detail: "seat signature does not verify over canonical record bytes" });
        continue;
      }
      if (!verifyBytes(issuerPub, outerBytes, env.issuer_signature)) {
        results.push({ line: lineNo, ok: false, error: "OUTER_SIGNATURE_INVALID", detail: "issuer signature does not verify over canonical envelope bytes" });
        continue;
      }
      const verdict = record["verdict"];
      if (typeof verdict !== "string" || verdict === "") {
        results.push({ line: lineNo, ok: false, error: "EMPTY_VERDICT", detail: "record verdict must be a non-empty string" });
        continue;
      }
      results.push({ line: lineNo, ok: true, verdict });
    } catch (e) {
      results.push({ line: lineNo, ok: false, error: "MALFORMED", detail: String(e instanceof Error ? e.message : e) });
    }
  }
  return results;
}

export function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
