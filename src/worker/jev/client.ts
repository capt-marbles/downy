import { z } from "zod";
// Schema verified against Cloudflare's typesafe/jev schema-input/output.json.
// Boolean questions are called `noul`; their response has no confidence field.
export type JevQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };
export type JevRequest = {
  state: string | Record<string, unknown>;
  questions: Record<string, JevQuestion>;
};
const probability = z.number().min(0).max(1);
export const JevResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("noul"), noul: probability }),
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        confidence: probability,
        probabilities: z.record(z.string(), probability),
      }),
      z.object({
        type: z.literal("score"),
        score: z.number(),
        confidence: probability,
        probabilities: z.record(z.string(), probability),
        legend: z.record(z.string(), z.string()),
      }),
    ]),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export type JevRunner = (request: JevRequest) => Promise<unknown>;
export async function withDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Jev deadline exceeded")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function runJev(ai: Ai, request: JevRequest) {
  return ai.run("typesafe/jev", request);
}
