import { tool } from "ai";
import { z } from "zod";
import { createAgent, getAgent } from "../../db/profile";

const Input = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe("The bot name requested or agreed by the user"),
  purpose: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe("Its purpose, only if the user supplied one"),
});
export function isNamedBotCreationRequest(text: string): boolean {
  if (text.startsWith("Voice lookup —")) {
    const turns = text.split(/(?:^|\n)You:\s*/);
    text = turns.length > 1 ? turns.at(-1)!.split(/\nDowny:/)[0] : "";
  }
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:create|make|set up)\s+(?:me\s+)?(?:(?:a|an|new)\s+)*bot\s+(?:named|called)\s+\S/i.test(
    text.trim(),
  );
}
export async function createBot(
  db: D1Database,
  input: z.infer<typeof Input>,
  initialize: (slug: string, name: string, purpose?: string) => Promise<void>,
) {
  const base = input.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `bot-${base || "new"}`.slice(0, 31).replace(/-$/, "");
  let record = await getAgent(db, slug);
  if (!record) {
    try {
      record = await createAgent(db, { slug, displayName: input.name });
    } catch (error) {
      record = await getAgent(db, slug);
      if (!record) throw error;
    }
  }
  if (record.displayName !== input.name || record.archivedAt !== null)
    return {
      state: "name_conflict" as const,
      error:
        "That name is already in use or archived. Ask for a different name.",
    };
  // The initializer is idempotent and never overwrites an existing identity.
  await initialize(slug, input.name, input.purpose);
  return {
    state: "ready" as const,
    name: record.displayName,
    slug,
    url: `/agent/${slug}`,
    message:
      "Bot is ready. No task has started and no connected accounts were copied.",
  };
}
export function createBotTool(args: {
  create: (input: z.infer<typeof Input>) => Promise<unknown>;
}) {
  return tool({
    description:
      "Create a new named Downy bot when the user asks to create one. Optional purpose comes from the user. Returns its chat link; show that link in the reply. Repeating the same name resumes the same bot without overwriting it. Does not start work, connect accounts, copy credentials, or schedule tasks. Do not suggest creating a bot for every task.",
    inputSchema: Input,
    execute: args.create,
  });
}
