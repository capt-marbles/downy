import type { Experimental_CompositionEvaluator } from "@json-render/core";
import { runJev } from "../jev/client";

type AiBinding = Parameters<typeof runJev>[0];

// The composer owns its catalog; this adapter only translates the transport.
// No Vercel Gateway key, provider fallback, or agent tool is involved.
export function createCloudflareEvaluator(
  ai: AiBinding,
  record: (entry: { model: string; inputTokens: number }) => void,
): Experimental_CompositionEvaluator {
  return async ({ state, questions, signal }) => {
    signal.throwIfAborted();
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      // Stop waiting on cancellation. The binding may still finish inference;
      // a deadline is not a claim that Cloudflare cancelled provider billing.
      const result = await Promise.race([
        runJev(ai, { state, questions }),
        cancelled,
      ]);
      signal.throwIfAborted();
      const answers = Object.fromEntries(
        Object.entries(questions).map(([name, question]) => {
          const answer = result.answers[name];
          if (
            answer?.type !== "choice" ||
            !Object.hasOwn(question.criteria, answer.choice)
          )
            throw new Error("Jev returned an unoffered or missing choice");
          return [
            name,
            { choice: answer.choice, confidence: answer.confidence },
          ];
        }),
      );
      record({ model: result.model, inputTokens: result.usage.input_tokens });
      return { answers, usage: { inputTokens: result.usage.input_tokens } };
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
    }
  };
}
