/**
 * runtime.ts — the one Mozaik runtime (defineRuntime) and the shared
 * state every participant reads: MandateLedger, ReceiptTrail, signer
 * keys, and the observer log.
 *
 * Shared state follows the shared-state example: a RuntimeState
 * subclass holding the crew's ledger/trail, read via
 * resolveRuntime().state inside situation processors. Genuine
 * concurrency comes from runLoop being fire-and-forget (one loopId per
 * invocation, no shared cursor) — the demo sends two agents' messages
 * without awaiting between them.
 */
import { defineRuntime, RuntimeState } from "@mozaik-ai/core";
import { MandateLedger } from "./mandate-gate.js";
import { ReceiptTrail, generateEdKeyPair, type ActionRecord, type EdKeyPair } from "./receipts.js";

export interface ObserverEntry {
  at: string;
  event: string;
  producer: string;
  detail: string;
}

export class CrewState extends RuntimeState {
  readonly ledger: MandateLedger;
  readonly trail: ReceiptTrail;
  readonly observerLog: ObserverEntry[] = [];
  private readonly signers = new Map<string, EdKeyPair>();

  constructor(opts: { ledger: MandateLedger; trail: ReceiptTrail; signers: Map<string, EdKeyPair> }) {
    super();
    this.ledger = opts.ledger;
    this.trail = opts.trail;
    for (const [k, v] of opts.signers) this.signers.set(k, v);
  }

  /** Actor ids used by the demo (stable, human-readable, local only). */
  actorId(role: "operator" | "lead" | "researcher"): string {
    return `crew-${role}`;
  }

  signerFor(actorId: string): EdKeyPair | undefined {
    return this.signers.get(actorId);
  }

  /**
   * Emit one action record to the trail, signed by the named actor's
   * key. Unknown actors (e.g. an anonymous seat with no key) are
   * attested by the operator key and the record says so — the inner
   * signature then proves the TRAIL recorded the claim, not that the
   * anonymous caller signed it.
   */
  emitAction(action: ActionRecord, actorId: string): void {
    const signer = this.signers.get(actorId);
    if (signer) {
      this.trail.emit(action, signer);
      return;
    }
    const operator = this.signers.get(this.actorId("operator"));
    if (!operator) throw new Error("no operator signer configured");
    this.trail.emit({ ...action, attested_by: "operator (caller supplied no signing key)", claimed_actor_id: actorId }, operator);
  }

  logEvent(event: string, producer: string, detail: string): void {
    this.observerLog.push({ at: new Date().toISOString(), event, producer, detail });
  }
}

export const { initializeRuntime, resolveRuntime, resolveParticipant, join, leave, sendMessage, sendEvent, runLoop } =
  defineRuntime<CrewState>();
