/**
 * participants.ts — operator (human), Lead + Researcher (agents), and
 * the Observer (human) who logs the transcript, interception events,
 * and receipts.
 *
 * Each agent reacts ONLY to message.sent events carrying its own STEP
 * prefix (STEP:lead-* / STEP:research-*), so one operator message
 * drives exactly one agent's loop. The processor builds the
 * InferenceInput from the agent's own memory + tools and calls
 * runLoop with a fresh CombinedInterceptionHandler — the per-loop
 * handler instance is what makes the once-guard in the handlers safe.
 */
import {
  Agent,
  InferenceInput,
  SituationContext,
  SituationHandler,
  SituationProcessor,
  SituationSpecification,
  createAgent,
  createHuman,
} from "@mozaik-ai/core";
import { CombinedInterceptionHandler } from "./interception.js";
import { resolveParticipant, resolveRuntime, runLoop } from "./runtime.js";
import { crewTools } from "./tools.js";

class StepSpecification extends SituationSpecification {
  constructor(private readonly prefix: string) {
    super();
  }
  isSatisfiedBy(context: SituationContext): boolean {
    if (context.event.type !== "message.sent") return false;
    const { message } = context.event.payload as { message: string };
    return typeof message === "string" && message.includes(`STEP:${this.prefix}`);
  }
}

class LoopProcessor implements SituationProcessor {
  apply(context: SituationContext): void {
    const agent = context.participant as Agent;
    const { message } = context.event.payload as { message: string };
    const state = resolveRuntime().state;
    const inferenceInput: InferenceInput = {
      model: "scripted-mock",
      context: agent.getMemory().getContext(),
      tools: agent.getTools(),
    };
    const loopStartSeq = state.trail.seqCount;
    runLoop(agent.getId(), message, inferenceInput, new CombinedInterceptionHandler(inferenceInput, loopStartSeq));
  }
}

function agentHandler(prefix: string): SituationHandler {
  return { specification: new StepSpecification(prefix), processor: new LoopProcessor() };
}

export const operator = createHuman({
  name: "Operator",
  capabilities: ["issue mandates"],
  handlers: [],
});

export const lead = createAgent({
  name: "Crew Lead",
  capabilities: ["coordinate", "plan", "hire"],
  instruction:
    "You are the crew lead. You hire the researcher for subtasks under a Warrant-shaped mandate. Never claim a payment occurred unless the receipt trail holds a gate ALLOW receipt. All inference here is scripted (STEP tags select deterministic steps).",
  tools: crewTools,
  handlers: [agentHandler("lead-")],
});

export const researcher = createAgent({
  name: "Crew Researcher",
  capabilities: ["research", "synthesize"],
  instruction:
    "You are the crew researcher. You fetch prices and perform simulated paid lookups only under a Warrant-shaped mandate, via pay_for_research. Never claim a payment occurred unless the receipt trail holds a gate ALLOW receipt. All inference here is scripted (STEP tags select deterministic steps).",
  tools: crewTools,
  handlers: [agentHandler("research-")],
});

class AllEventsSpecification extends SituationSpecification {
  isSatisfiedBy(_context: SituationContext): boolean {
    return true;
  }
}

class ObserverProcessor implements SituationProcessor {
  apply(context: SituationContext): void {
    const state = resolveRuntime().state;
    let producerName = context.event.producerId;
    try {
      producerName = resolveParticipant(context.event.producerId).getManifest().name;
    } catch {
      // Producer may be the runtime itself; keep the raw id.
    }
    const detail = JSON.stringify(context.event.payload).slice(0, 300);
    state.logEvent(context.event.type, producerName, detail);
    const short = detail.length > 160 ? detail.slice(0, 160) + "…" : detail;
    console.log(`[observer] ${context.event.type} <${producerName}> ${short}`);
  }
}

export const observer = createHuman({
  name: "Runtime Observer",
  capabilities: [],
  handlers: [{ specification: new AllEventsSpecification(), processor: new ObserverProcessor() }],
});
