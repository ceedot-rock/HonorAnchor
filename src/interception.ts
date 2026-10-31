/**
 * interception.ts — Mozaik InterceptionHandlers. Defense in depth,
 * labeled honestly:
 *
 * 1. GatePreviewHandler (function_call): previews the spend against
 *    the shared MandateLedger WITHOUT booking. On deny it blocks the
 *    call, receipts the denial itself (the preview emits no record —
 *    the handler does, so every decision is receipted), and returns
 *    an "inference" transition carrying a denial FunctionCallOutput,
 *    exactly as the human-in-the-loop example rejects a transfer. On
 *    allow it returns false from isSatisfiedBy (the call proceeds and
 *    the tool invoke() performs the real booking gate, which
 *    re-checks cumulatively — a preview-allow can still be denied at
 *    booking if a concurrent spend landed first).
 *    LIMIT: interception alone is not the enforcement point. A direct
 *    invoke() bypasses it; invoke() gates regardless.
 * 2. PaymentClaimHandler (model_message): blocks a model answer that
 *    claims a payment/settlement occurred when no gate ALLOW receipt
 *    has been recorded since this loop started, looping back to
 *    message_received with a correction (the Safety example pattern).
 *    LIMIT: it is a text-pattern guard, not proof. The trail is the
 *    proof; this handler only stops the cheapest lie.
 *
 * runLoop takes ONE handler, so CombinedInterceptionHandler delegates
 * to both in order; the first satisfied handler wins. Each handler
 * instance is created per runLoop and carries a once-guard (spike v1:
 * an unguarded handler + deterministic runner loops forever).
 */
import {
  ExecutableTransition,
  FunctionCallItem,
  FunctionCallOutputItem,
  InferenceInput,
  InterceptionHandler,
  ModelMessageItem,
} from "@mozaik-ai/core";
import { fingerprint } from "./mandate-gate.js";
import { resolveRuntime } from "./runtime.js";

const SPEND_TOOLS = new Set(["pay_for_research"]);
const PAYMENT_CLAIM = /(payment|paid|settled|settlement).*(completed|executed|made|done)|completed.*(payment|settlement)/i;

function parseCallArgs(call: FunctionCallItem): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(call.args);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class GatePreviewHandler implements InterceptionHandler {
  private done = false;

  isSatisfiedBy(transition: ExecutableTransition): boolean {
    if (this.done || transition.nextStateId !== "function_call") return false;
    const { call } = transition.input as { call: FunctionCallItem };
    if (!SPEND_TOOLS.has(call.name)) return false;
    const args = parseCallArgs(call);
    const state = resolveRuntime().state;
    const decision = state.ledger.previewGate(
      args["warrant"] as never,
      typeof args["caller_agent_id"] === "string" ? args["caller_agent_id"] : "",
      args["cost_cents"] as number,
    );
    return !decision.ok;
  }

  async handle(transition: ExecutableTransition): Promise<ExecutableTransition> {
    this.done = true;
    const { call, inferenceInput } = transition.input as { call: FunctionCallItem; inferenceInput: InferenceInput };
    const args = parseCallArgs(call);
    const state = resolveRuntime().state;
    const warrant = args["warrant"] as never;
    const caller = typeof args["caller_agent_id"] === "string" ? args["caller_agent_id"] : "";
    const cost = args["cost_cents"] as number;
    const decision = state.ledger.previewGate(warrant, caller, cost);
    // Receipt the denial: previews emit no record, so the handler must.
    if (!decision.ok) {
      let fp: string | null = null;
      try {
        fp = fingerprint(warrant);
      } catch {
        fp = null;
      }
      state.emitAction(
        {
          action: "gate.decision",
          verdict: "DENY",
          warrant_fingerprint: fp ?? "unfingerprintable-warrant",
          caller_agent_id: caller,
          cost_cents: typeof cost === "number" && Number.isInteger(cost) ? cost : 0,
          cumulative_spent_cents: (() => {
            try {
              return state.ledger.spentCents(warrant);
            } catch {
              return 0;
            }
          })(),
          ok: false,
          code: decision.code,
          detail: decision.detail,
          denied_at: "function_call-interception (preview)",
        },
        caller,
      );
      const output = FunctionCallOutputItem.create(
        call.callId,
        JSON.stringify({ denied: true, code: decision.code, detail: decision.detail, executed: false }),
      );
      inferenceInput.context.addContextItems([call, output]);
      return { nextStateId: "inference", input: inferenceInput };
    }
    return transition;
  }
}

export class PaymentClaimHandler implements InterceptionHandler {
  private done = false;
  constructor(
    private readonly inferenceInput: InferenceInput,
    private readonly loopStartSeq: number,
  ) {
    void this.inferenceInput;
  }

  isSatisfiedBy(transition: ExecutableTransition): boolean {
    if (this.done || transition.nextStateId !== "model_message") return false;
    const { answer } = transition.input as { answer: ModelMessageItem };
    const text = answer.content.text;
    if (!PAYMENT_CLAIM.test(text)) return false;
    if (/simulated/i.test(text)) return false;
    const state = resolveRuntime().state;
    const allowSinceStart = state.trail.recordsSince(this.loopStartSeq).some(
      (r) => r["action"] === "gate.decision" && r["verdict"] === "ALLOW",
    );
    return !allowSinceStart;
  }

  async handle(transition: ExecutableTransition): Promise<ExecutableTransition> {
    this.done = true;
    const state = resolveRuntime().state;
    state.logEvent("interception.payment-claim-blocked", "interception", "model answer claimed a payment with no ALLOW receipt since loop start");
    return {
      nextStateId: "message_received",
      input: {
        content:
          "CORRECTION: do NOT claim any payment occurred. State only that no payment was made and no receipt exists. The mandate gate remains the enforcement point.",
        input: this.inferenceInput,
      },
    };
  }
}

export class CombinedInterceptionHandler implements InterceptionHandler {
  private readonly handlers: InterceptionHandler[];

  constructor(inferenceInput: InferenceInput, loopStartSeq: number) {
    this.handlers = [new GatePreviewHandler(), new PaymentClaimHandler(inferenceInput, loopStartSeq)];
  }

  isSatisfiedBy(transition: ExecutableTransition): boolean {
    return this.handlers.some((h) => h.isSatisfiedBy(transition));
  }

  async handle(transition: ExecutableTransition): Promise<ExecutableTransition> {
    for (const h of this.handlers) {
      if (h.isSatisfiedBy(transition)) return h.handle(transition);
    }
    return transition;
  }
}
