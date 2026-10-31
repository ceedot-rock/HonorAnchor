/**
 * runner.ts — the scripted InferenceRunner.
 *
 * Deterministic by design, labeled "scripted" in every receipt: no
 * provider is called, no API key is needed, and the demo runs with
 * zero keys. The runner never invents a tool call or an answer: it
 * follows STEP tags in the operator message (registered by the demo
 * driver) and the tail rule proven in spike v2:
 *
 * - If the context tail is a FunctionCallOutputItem, the tool has
 *   answered: return the step's follow-up answer. NEVER re-issue a
 *   call whose output is already in context (spike v1 looped forever
 *   on exactly that mistake).
 * - If the newest user message carries STEP:<tag>, perform that step:
 *   its first unanswered tool call, or its scripted answer.
 * - If the newest user message is a CORRECTION (from the
 *   model_message interception handler), return the corrected answer.
 * - Otherwise, return a generic scripted answer echoing the message.
 *
 * A small awaited delay in run() makes loop interleaving visible in
 * the observer log when two agents think at once.
 *
 * Real-provider path (documented, never required): set
 * ACCOUNTABLE_CREW_USE_DEFAULT_RUNNER=1 when initializing the runtime
 * (see demo.ts) to skip this runner and use Mozaik's default
 * provider-backed runner instead. That path needs OPENAI_API_KEY (or
 * another provider's env) and a real model name; the scripted demo
 * scenarios do not run under it, because free-text model output is not
 * step-tagged. The gate + trail enforcement is identical either way:
 * it lives in the tools and interception handlers, not in the runner.
 */
import {
  FunctionCallItem,
  FunctionCallOutputItem,
  InferenceInput,
  InferenceOutput,
  InferenceRunner,
  ModelMessageItem,
  SemanticEvent,
  UserMessageItem,
} from "@mozaik-ai/core";

export interface ScriptStep {
  /** Tool calls this step performs, in order. */
  calls?: Array<{ name: string; args: Record<string, unknown> }>;
  /** Scripted model answer when the step performs no call. */
  answer: string;
  /** Scripted model answer after the step's tool call(s) complete. */
  answerAfterTool?: string;
}

export const scriptSteps = new Map<string, ScriptStep>();

export function registerStep(tag: string, step: ScriptStep): void {
  scriptSteps.set(tag, step);
}

export function clearSteps(): void {
  scriptSteps.clear();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ScriptedInferenceRunner implements InferenceRunner {
  async run(input: InferenceInput): Promise<InferenceOutput> {
    // Simulated thinking time: exposes genuine loop overlap in the
    // observer log when two runLoops are in flight at once.
    await sleep(40);
    const items = [...input.context.getItems()];
    const last = items[items.length - 1];

    if (last instanceof FunctionCallOutputItem) {
      const step = this.stepFor(items);
      const text = step?.answerAfterTool ?? `Tool result recorded (scripted): ${last.output.text}`;
      return this.answer(text, input);
    }

    const lastUser = [...items].reverse().find((i) => i instanceof UserMessageItem) as UserMessageItem | undefined;
    const text = lastUser?.content.text ?? "";
    if (text.includes("CORRECTION: do NOT claim")) {
      return this.answer(
        "Corrected (scripted): no payment was made and no payment receipt exists. The mandate gate remains the enforcement point; only a gate ALLOW receipt in the trail proves a spend.",
        input,
      );
    }
    const tagMatch = /STEP:([A-Za-z0-9_-]+)/.exec(text);
    if (tagMatch) {
      const step = scriptSteps.get(tagMatch[1]!);
      if (!step) return this.answer(`Scripted: no step registered for tag ${tagMatch[1]}. No tool was called.`, input);
      // Only calls AFTER the current step message count: the agent's
      // memory accumulates across loops, so scanning the whole context
      // would mistake an earlier loop's call for this step's call and
      // skip the tool entirely.
      let lastUserIdx = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i] instanceof UserMessageItem) {
          lastUserIdx = i;
          break;
        }
      }
      const segment = lastUserIdx >= 0 ? items.slice(lastUserIdx) : items;
      const pending = (step.calls ?? []).find(
        (c) => !segment.some((i) => i instanceof FunctionCallItem && i.name === c.name),
      );
      if (pending) {
        return {
          items: [
            FunctionCallItem.rehydrate({
              callId: `call-${tagMatch[1]}-${pending.name}`,
              name: pending.name,
              args: JSON.stringify(pending.args),
            }),
          ],
          tokenUsage: undefined,
          rowResponse: { mock: true, model: input.model, scripted: true, step: tagMatch[1] },
        };
      }
      return this.answer(step.answer, input);
    }
    return this.answer(`Scripted reply (no provider called): ${text.slice(0, 80)}`, input);
  }

  async *stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
    yield SemanticEvent.create("inference.output", input.model, await this.run(input));
  }

  private stepFor(items: readonly unknown[]): ScriptStep | undefined {
    const lastUser = [...items].reverse().find((i) => i instanceof UserMessageItem) as UserMessageItem | undefined;
    const text = lastUser?.content.text ?? "";
    const tagMatch = /STEP:([A-Za-z0-9_-]+)/.exec(text);
    return tagMatch ? scriptSteps.get(tagMatch[1]!) : undefined;
  }

  private answer(text: string, input: InferenceInput): InferenceOutput {
    return {
      items: [ModelMessageItem.rehydrate({ text })],
      tokenUsage: undefined,
      rowResponse: { mock: true, model: input.model, scripted: true },
    };
  }
}
