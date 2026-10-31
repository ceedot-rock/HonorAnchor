/**
 * mandate-gate.ts — faithful TypeScript port of the Python mandate gate
 * (~/workspace/accountable-crew/mandate-gate/gate.py over the Warrant
 * port at ~/workspace/warrant-crossmint/warrant.py).
 *
 * Two layers, as in the original:
 * - gateCheck() is stateless: one spend against one warrant document
 *   (caller == effective last hop, single cost <= cap, not expired).
 * - MandateLedger adds cumulative spend per warrant document, keyed by
 *   a fingerprint (SHA-256 of the canonical warrant JSON, first 16 hex).
 *   A spend that would push the running total over the cap is denied
 *   OVER_BUDGET even when the single call would pass.
 *
 * Deny by default. Every decision — allow and deny alike — is reported
 * to the onDecision callback BEFORE the decision is returned, so the
 * caller can receipt it. Denied spends are never booked.
 *
 * Deny codes are verbatim from the Python port:
 * WARRANT_DENIED | WARRANT_EXPIRED | OVER_BUDGET | AGENT_MISMATCH.
 * Attenuation only narrows: a widening attempt throws WarrantError —
 * that exception IS the tamper signal; callers must let it surface.
 *
 * Money is integer cents only. No floats anywhere.
 */

import { fingerprintOf } from "./canonical.js";

export class WarrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarrantError";
  }
}

export interface WarrantBody {
  agent_id: string;
  max_cents: number;
  until: number;
}

export interface Warrant {
  v: 1;
  kind: "spl-narrow";
  authority: WarrantBody;
  hops: WarrantBody[];
}

function intCents(n: unknown): number {
  if (typeof n === "boolean" || typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new WarrantError("warrant_cents");
  }
  return n;
}

function intUntil(n: unknown): number {
  if (typeof n === "boolean" || typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    throw new WarrantError("warrant_until");
  }
  return n;
}

function bodyOf(raw: unknown): WarrantBody {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new WarrantError("warrant_agent");
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec["agent_id"] !== "string" || rec["agent_id"] === "") {
    throw new WarrantError("warrant_agent");
  }
  return {
    agent_id: rec["agent_id"],
    max_cents: intCents(rec["max_cents"]),
    until: intUntil(rec["until"]),
  };
}

/** Issue the root mandate for a crew job (the operator's slip). */
export function issueMandate(agentId: string, maxCents: number, until: number): Warrant {
  return { v: 1, kind: "spl-narrow", authority: bodyOf({ agent_id: agentId, max_cents: maxCents, until }), hops: [] };
}

/**
 * Attenuate a mandate down the chain for a hired sub-agent.
 * Raises WarrantError on any widening attempt.
 */
export function delegate(warrant: Warrant, agentId: string, maxCents: number, until: number): Warrant {
  if (typeof warrant !== "object" || warrant === null || warrant.kind !== "spl-narrow" || warrant.v !== 1) {
    throw new WarrantError("warrant_kind");
  }
  const hop = bodyOf({ agent_id: agentId, max_cents: maxCents, until });
  const prev = warrant.hops.length > 0 ? warrant.hops[warrant.hops.length - 1]! : warrant.authority;
  if (hop.max_cents > prev.max_cents) throw new WarrantError("warrant_widen_cents");
  if (hop.until > prev.until) throw new WarrantError("warrant_widen_until");
  return { v: 1, kind: "spl-narrow", authority: warrant.authority, hops: [...warrant.hops, hop] };
}

/** Stable id for one warrant document (one ledger account). */
export function fingerprint(warrant: Warrant): string {
  return fingerprintOf(warrant);
}

export type VerifyResult =
  | { ok: true; body: WarrantBody }
  | { ok: false; error: string };

export function verifyWarrant(warrant: unknown, now?: number): VerifyResult {
  const nowSec = now ?? Math.floor(Date.now() / 1000);
  try {
    if (typeof warrant !== "object" || warrant === null) return { ok: false, error: "warrant_kind" };
    const w = warrant as Record<string, unknown>;
    if (w["kind"] !== "spl-narrow" || w["v"] !== 1) return { ok: false, error: "warrant_kind" };
    const chain = [bodyOf(w["authority"]), ...((w["hops"] as unknown[] | undefined) ?? []).map(bodyOf)];
    for (let i = 1; i < chain.length; i++) {
      if (chain[i]!.max_cents > chain[i - 1]!.max_cents) return { ok: false, error: "warrant_widen_cents" };
      if (chain[i]!.until > chain[i - 1]!.until) return { ok: false, error: "warrant_widen_until" };
    }
    const cur = chain[chain.length - 1]!;
    if (nowSec >= cur.until) return { ok: false, error: "warrant_expired" };
    return { ok: true, body: cur };
  } catch (e) {
    if (e instanceof WarrantError) return { ok: false, error: e.message || "warrant_invalid" };
    return { ok: false, error: "warrant_invalid" };
  }
}

export type GateDecision =
  | { ok: true; body: WarrantBody; remaining_cents: number }
  | { ok: false; code: "WARRANT_DENIED" | "WARRANT_EXPIRED" | "OVER_BUDGET" | "AGENT_MISMATCH"; detail: string };

/** Stateless single-spend check. Deny by default on any failure. */
export function gateCheck(warrant: unknown, callerAgentId: string, costCents: number, now?: number): GateDecision {
  if (typeof costCents === "boolean" || typeof costCents !== "number" || !Number.isInteger(costCents) || costCents < 0) {
    return { ok: false, code: "WARRANT_DENIED", detail: "invalid cost_cents" };
  }
  const v = verifyWarrant(warrant, now);
  if (!v.ok) {
    const code = v.error === "warrant_expired" ? "WARRANT_EXPIRED" : "WARRANT_DENIED";
    return { ok: false, code, detail: v.error };
  }
  const body = v.body;
  if (body.agent_id !== callerAgentId) {
    return { ok: false, code: "AGENT_MISMATCH", detail: `warrant names ${JSON.stringify(body.agent_id)}, caller is ${JSON.stringify(callerAgentId)}` };
  }
  if (costCents > body.max_cents) {
    return { ok: false, code: "OVER_BUDGET", detail: `cost ${costCents}c exceeds warrant cap ${body.max_cents}c` };
  }
  return { ok: true, body, remaining_cents: body.max_cents };
}

export interface DecisionRecord {
  action: "gate.decision";
  verdict: "ALLOW" | "DENY";
  warrant_fingerprint: string;
  caller_agent_id: string;
  cost_cents: number;
  cumulative_spent_cents: number;
  ok: boolean;
  code: string | null;
  detail: string;
  remaining_cents?: number;
}

export class MandateLedger {
  private spent = new Map<string, number>();
  readonly onDecision: ((record: DecisionRecord) => void) | null;

  constructor(onDecision: ((record: DecisionRecord) => void) | null = null) {
    this.onDecision = onDecision;
  }

  spentCents(warrant: Warrant): number {
    return this.spent.get(fingerprint(warrant)) ?? 0;
  }

  /**
   * Non-booking preview: what gatePayment WOULD decide, without booking
   * the spend or emitting a decision record. Used by the Mozaik
   * function_call interception handler, which must not double-book
   * (the tool invoke() performs the real, booking gate). A preview that
   * allows can still be denied at booking time if a concurrent spend
   * lands first — the booking gate re-checks cumulatively and atomically.
   */
  previewGate(warrant: Warrant, callerAgentId: string, costCents: number, now?: number): GateDecision {
    const fp = fingerprint(warrant);
    const spent = this.spent.get(fp) ?? 0;
    const decision = gateCheck(warrant, callerAgentId, costCents, now);
    if (!decision.ok) return decision;
    const cap = decision.body.max_cents;
    if (spent + costCents > cap) {
      return {
        ok: false,
        code: "OVER_BUDGET",
        detail: `cumulative spend ${spent}c + cost ${costCents}c exceeds warrant cap ${cap}c`,
      };
    }
    return { ok: true, body: decision.body, remaining_cents: cap - spent - costCents };
  }

  /** Approve or deny one spend, cumulative-aware. Books allowed spends. */
  gatePayment(warrant: Warrant, callerAgentId: string, costCents: number, now?: number): GateDecision {
    const fp = fingerprint(warrant);
    const spent = this.spent.get(fp) ?? 0;
    let decision = gateCheck(warrant, callerAgentId, costCents, now);
    if (decision.ok) {
      const cap = decision.body.max_cents;
      if (spent + costCents > cap) {
        decision = {
          ok: false,
          code: "OVER_BUDGET",
          detail: `cumulative spend ${spent}c + cost ${costCents}c exceeds warrant cap ${cap}c`,
        };
      } else {
        const newSpent = spent + costCents;
        this.spent.set(fp, newSpent);
        decision = { ...decision, remaining_cents: cap - newSpent };
      }
    }
    const record: DecisionRecord = {
      action: "gate.decision",
      verdict: decision.ok ? "ALLOW" : "DENY",
      warrant_fingerprint: fp,
      caller_agent_id: callerAgentId,
      cost_cents: costCents,
      cumulative_spent_cents: this.spent.get(fp) ?? spent,
      ok: decision.ok,
      code: decision.ok ? null : decision.code,
      detail: decision.ok ? "" : decision.detail,
    };
    if (decision.ok) record.remaining_cents = decision.remaining_cents;
    if (this.onDecision) this.onDecision(record);
    return decision;
  }
}
