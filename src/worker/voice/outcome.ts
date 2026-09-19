import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import { normalizeWorkspacePath } from "../agent/child-workspace-rpc";

const SavedReportSchema = z.object({
  saved: z.literal(true),
  path: z
    .string()
    .regex(/^workspace\/(?:research|reports|drafts)\/[a-zA-Z0-9_-]+\.md$/),
});

const ReadFileSchema = z.object({ path: z.string(), content: z.string() });

function readWorkspacePath(output: unknown): string | undefined {
  const read = ReadFileSchema.safeParse(output);
  if (!read.success) return undefined;
  try {
    const path = normalizeWorkspacePath(read.data.path);
    return path.startsWith("workspace/") ? path : undefined;
  } catch {
    // Invalid paths never become navigable links.
    return undefined;
  }
}

// The voice service receives speech, while verified file destinations stay in
// the persisted chat receipt. Do not make a link out of a model-invented path.
function spokenText(text: string, paths: Set<string>): string {
  for (const path of paths)
    text = text.replaceAll(`/${path}`, "the file").replaceAll(path, "the file");
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`\/?workspace\/[^`]+`/g, "the file")
    .replace(/`?\/?workspace\/[^\s`<>"'()[\]]+`?/g, "the file")
    .replace(/https?:\/\/[^\s<>]+|\/agent\/[^\s<>]+/g, "the link");
}

export function voiceTurnOutcome(messages: UIMessage[]): {
  text: string;
  corrected: boolean;
  savedPaths: string[];
  filePaths: string[];
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
  const readPaths = new Set<string>();
  for (const part of parts) {
    if (!isToolUIPart(part)) continue;
    const name = getToolName(part);
    if (part.state === "output-error" || part.state === "output-denied")
      failures.add(name);
    if (part.state !== "output-available") continue;
    failures.delete(name);
    if (name === "read") {
      const path = readWorkspacePath(part.output);
      if (path) readPaths.add(path);
    }

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
      filePaths: [...savedPaths],
    };
  if (failures.size)
    return {
      text: failures.has("spawn_background_task")
        ? "The background task did not start. No report was saved. Please retry the request; nothing is running in the background."
        : "I couldn't complete that request because a tool failed or was blocked. No report was saved. Please check the chat and retry.",
      corrected: true,
      savedPaths: [],
      filePaths: [],
    };
  // Intermediate promises are not outcomes. Speak only the final text part.
  return {
    text:
      spokenText(
        parts.filter((part) => part.type === "text").at(-1)?.text ??
          "No completed answer was returned. Please check the chat and retry.",
        readPaths,
      ) + (readPaths.size ? " I've added the file links in chat." : ""),
    corrected: false,
    savedPaths: [],
    filePaths: [...readPaths],
  };
}

export function voiceOutcomeChatText(
  outcome: ReturnType<typeof voiceTurnOutcome>,
  agentSlug: string,
): string {
  return [
    outcome.text,
    ...outcome.filePaths.map((path) => {
      const label = path
        .split("/")
        .at(-1)!
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]/g, " ")
        .replace(/[[\]\\\r\n]/g, "");
      const destination = path.split("/").map(encodeURIComponent).join("/");
      return `[Open ${label}](/agent/${encodeURIComponent(agentSlug)}/workspace/${destination})`;
    }),
  ].join("\n\n");
}
