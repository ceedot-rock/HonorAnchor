/**
 * tools.ts — Mozaik spend tools. THE enforcement point is here AND in
 * the function_call interception handler (see interception.ts):
 *
 * - Every spend tool's invoke() calls ledger.gatePayment() BEFORE any
 *   simulated execution. On deny it returns the denial and executes
 *   nothing; denied spends are never booked (the gate guarantees it).
 * - The interception handler performs a non-booking previewGate() and
 *   blocks denied calls before they reach invoke(), receipting the
 *   denial itself. If a call reaches invoke() without a handler (direct
 *   invoke, or a race), the booking gate still enforces.
 *
 * Spend is SIMULATED cents against mandate caps. No live rail, no MCP,
 * no x402, no on-chain payment, no real money. The warrant document
 * and caller id arrive in the tool arguments (the model supplies them
 * from the scripted step), and gateCheck() verifies the warrant
 * structurally — a widened/tampered warrant fails verification and is
 * denied WARRANT_DENIED, exactly as in the Python port.
 *
 * Tools read the live runtime state lazily at invoke time (the
 * shared-state example pattern), so the same tool objects can be
 * attached to participants created before initializeRuntime().
 */
import type { Tool } from "@mozaik-ai/core";
import { fingerprintOf } from "./canonical.js";
import { gateCheck } from "./mandate-gate.js";
import { resolveRuntime } from "./runtime.js";
import type { CrewState } from "./runtime.js";

export interface SpendArgs {
  warrant?: unknown;
  caller_agent_id?: unknown;
  cost_cents?: unknown;
  task?: unknown;
}

function stateOrNull(): CrewState | null {
  try {
    return resolveRuntime().state as CrewState;
  } catch {
    return null;
  }
}

function denyResult(code: string, detail: string, fp: string | null): Record<string, unknown> {
  return { denied: true, code, detail, warrant_fingerprint: fp, executed: false };
}

function fingerprintSafe(warrant: unknown): string | null {
  try {
    return fingerprintOf(warrant);
  } catch {
    return null;
  }
}

function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

export const payForResearch: Tool = {
  type: "function",
  name: "pay_for_research",
  description:
    "Simulate paying for a research subtask in integer cents. The spend is checked against the supplied Warrant-shaped mandate BEFORE any simulated settlement; denied spends execute nothing. No real payment occurs.",
  parameters: {
    type: "object",
    properties: {
      warrant: { type: "object", description: "Warrant-shaped mandate document {v, kind, authority, hops}." },
      caller_agent_id: { type: "string", description: "Agent id claiming to spend under the mandate (must equal the effective last hop)." },
      cost_cents: { type: "integer", description: "Simulated cost in integer cents (>= 0)." },
      task: { type: "string", description: "What the simulated payment is for." },
    },
    required: ["warrant", "caller_agent_id", "cost_cents"],
    additionalProperties: false,
  },
  strict: false,
  invoke: async (rawArgs: unknown) => {
    const args = asRecord(rawArgs) as SpendArgs & Record<string, unknown>;
    const state = stateOrNull();
    if (!state) return denyResult("WARRANT_DENIED", "runtime not initialized", fingerprintSafe(args.warrant));
    const warrant = args.warrant as never;
    const caller = typeof args.caller_agent_id === "string" ? args.caller_agent_id : "";
    const cost = args.cost_cents;
    const decision = state.ledger.gatePayment(warrant, caller, cost as number);
    const fp = fingerprintSafe(args.warrant);
    if (!decision.ok) return denyResult(decision.code, decision.detail, fp);
    // Simulated settlement only — this object is the whole "execution".
    return {
      status: "simulated-settled",
      simulated: true,
      cost_cents: cost,
      remaining_cents: decision.remaining_cents,
      warrant_fingerprint: fp,
      task: typeof args.task === "string" ? args.task : "",
      executed: false,
    };
  },
};

export const fetchPrice: Tool = {
  type: "function",
  name: "fetch_price",
  description: "Fetch the simulated price of a research lookup in integer cents. Free (0c): no mandate gate applies. The price is fixed and labeled simulated.",
  parameters: {
    type: "object",
    properties: {
      resource: { type: "string", description: "Resource being priced, e.g. 'pcc-info'." },
    },
    required: ["resource"],
    additionalProperties: false,
  },
  strict: false,
  invoke: async (rawArgs: unknown) => {
    const args = asRecord(rawArgs);
    const state = stateOrNull();
    const resource = typeof args["resource"] === "string" ? args["resource"] : "unknown";
    const record = { action: "price.fetched", verdict: "RECORDED", resource, price_cents: 2, simulated: true };
    if (state) state.emitAction(record, state.actorId("researcher"));
    return { resource, price_cents: 2, currency: "cents (simulated)", simulated: true };
  },
};

export const deliverResult: Tool = {
  type: "function",
  name: "deliver_result",
  description: "Deliver a finished research result back to the crew. Free (0c): no mandate gate applies. The delivery text is recorded in the receipt trail.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "Task being delivered." },
      result_text: { type: "string", description: "The result text." },
    },
    required: ["task", "result_text"],
    additionalProperties: false,
  },
  strict: false,
  invoke: async (rawArgs: unknown) => {
    const args = asRecord(rawArgs);
    const state = stateOrNull();
    const task = typeof args["task"] === "string" ? args["task"] : "";
    const resultText = typeof args["result_text"] === "string" ? args["result_text"] : "";
    if (state) {
      state.emitAction({ action: "result.delivered", verdict: "RECORDED", task, result_text: resultText }, state.actorId("researcher"));
    }
    return { status: "delivered", task, result_text: resultText, simulated: true };
  },
};

export const crewTools: Tool[] = [payForResearch, fetchPrice, deliverResult];

/** Re-exported for tests: stateless check without booking. */
export { gateCheck };
