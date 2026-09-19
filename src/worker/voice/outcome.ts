import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

const SavedReportSchema = z.object({
  saved: z.literal(true),
  path: z
    .string()
    .regex(/^workspace\/(?:research|reports|drafts)\/[a-zA-Z0-9_-]+\.md$/),
});

export function voiceTurnOutcome(messages: UIMessage[]): {
  text: string;
  corrected: boolean;
  savedPaths: string[];
} {
  const parts = messages
    .filter(
      (message) =>
        message.role === "assistant" &&
        !message.id.startsWith("voice-transcript:"),
    )
    .flatMap((message) => message.parts);
  const failures = new Set<string>();
  const savedPaths = new Set<string>();
  for (const part of parts) {
    if (!isToolUIPart(part)) continue;
    const name = getToolName(part);
    if (part.state === "output-error" || part.state === "output-denied")
      failures.add(name);
    if (part.state !== "output-available") continue;
    failures.delete(name);
    if (name === "write") {
      const saved = SavedReportSchema.safeParse(part.output);
      if (saved.success) savedPaths.add(saved.data.path);
      else failures.add(name);
    }
  }
  if (savedPaths.size)
    return {
      text: `Your report is saved in the workspace. I've added a link in chat.${failures.size ? " An additional step failed; check the chat for details." : ""}`,
      corrected: true,
      savedPaths: [...savedPaths],
    };
  if (failures.size)
    return {
      text: failures.has("spawn_background_task")
        ? "The background task did not start. No report was saved. Please retry the request; nothing is running in the background."
        : "I couldn't complete that request because a tool failed or was blocked. No report was saved. Please check the chat and retry.",
      corrected: true,
      savedPaths: [],
    };
  // Intermediate promises are not outcomes. Speak only the final text part.
  return {
    text:
      parts.filter((part) => part.type === "text").at(-1)?.text ??
      "No completed answer was returned. Please check the chat and retry.",
    corrected: false,
    savedPaths: [],
  };
}
