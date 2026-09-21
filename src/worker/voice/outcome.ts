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

const GmailDraftSchema = z.object({
  state: z.literal("draft_created"),
  url: z.string().url(),
  sent: z.literal(false).optional(),
});

const StagedProposalSchema = z.object({
  stagedActionId: z.string().min(1),
  state: z.literal("proposed"),
});

const DispatchedTaskSchema = z.object({
  taskId: z.string().min(1),
  status: z.literal("dispatched"),
});

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

function hasUnverifiedFileLink(text: string, verified: Set<string>): boolean {
  for (const match of text.matchAll(
    /\]\(\/agent\/[^/]+\/workspace\/([^)]+)\)/g,
  )) {
    try {
      const path = normalizeWorkspacePath(decodeURIComponent(match[1]));
      if (!verified.has(path)) return true;
    } catch {
      return true;
    }
  }
  return !verified.size && /workspace\/[^\s]+\.[a-z0-9]+/i.test(text);
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

type ToolReceipts = {
  failures: Set<string>;
  savedPaths: Set<string>;
  readPaths: Set<string>;
  dispatchedTaskIds: Set<string>;
  stagedActionIds: Set<string>;
  draftUrls: Set<string>;
};

// Every verified outcome comes from a tool receipt, never from prose. A tool
// that later succeeded clears its earlier failure; a malformed success output
// counts as a failure for the tools whose receipts are checked.
function collectToolReceipts(parts: UIMessage["parts"]): ToolReceipts {
  const failures = new Set<string>();
  const savedPaths = new Set<string>();
  const readPaths = new Set<string>();
  const dispatchedTaskIds = new Set<string>();
  const stagedActionIds = new Set<string>();
  const draftUrls = new Set<string>();
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
    if (name === "spawn_background_task") {
      const dispatched = DispatchedTaskSchema.safeParse(part.output);
      if (dispatched.success) dispatchedTaskIds.add(dispatched.data.taskId);
      else failures.add(name);
    }
    if (name === "stage_action") {
      const staged = StagedProposalSchema.safeParse(part.output);
      if (staged.success) stagedActionIds.add(staged.data.stagedActionId);
      else failures.add(name);
    }
    if (name === "gmail_email") {
      // Only a draft receipt is an outcome. Searches and reads pass through;
      // a failed state from the wrapper counts as a failure.
      const draft = GmailDraftSchema.safeParse(part.output);
      if (draft.success) draftUrls.add(draft.data.url);
      else if (
        z.object({ state: z.literal("failed") }).safeParse(part.output).success
      )
        failures.add(name);
    }
  }
  return {
    failures,
    savedPaths,
    readPaths,
    dispatchedTaskIds,
    stagedActionIds,
    draftUrls,
  };
}

export function voiceTurnOutcome(messages: UIMessage[]): {
  text: string;
  corrected: boolean;
  savedPaths: string[];
  filePaths: string[];
  /** Read-only research workers started this turn; dispatched, not done. */
  dispatchedTaskIds: string[];
  /** Proposal cards staged this turn; awaiting a tap, never run. */
  stagedActionIds: string[];
  /** Gmail draft URLs verified from tool receipts this turn; never sent. */
  draftUrls: string[];
  unverifiedFileClaim?: boolean;
} {
  const parts = messages
    .filter(
      (message) =>
        message.role === "assistant" &&
        !message.id.startsWith("voice-transcript:"),
    )
    .flatMap((message) => message.parts);
  const {
    failures,
    savedPaths,
    readPaths,
    dispatchedTaskIds,
    stagedActionIds,
    draftUrls,
  } = collectToolReceipts(parts);
  const dispatched = [...dispatchedTaskIds];
  const staged = [...stagedActionIds];
  const drafts = [...draftUrls];
  const finalText =
    parts.filter((part) => part.type === "text").at(-1)?.text ??
    "No completed answer was returned. Please check the chat and retry.";
  const unverifiedFileClaim = hasUnverifiedFileLink(
    finalText,
    new Set([...savedPaths, ...readPaths]),
  );
  if (dispatched.length && !failures.size && !savedPaths.size)
    // A dispatch receipt is the outcome; the model's own promise about what
    // the worker will do is not. The finish is announced separately. An
    // invented path in the prose is still corrected in chat.
    return {
      text: "I've started a read-only background research task. Its findings will be saved and linked in chat when it finishes, and I'll tell you when that happens, even on a later call.",
      corrected: true,
      savedPaths: [],
      filePaths: [...readPaths],
      dispatchedTaskIds: dispatched,
      stagedActionIds: staged,
      draftUrls: drafts,
      ...(unverifiedFileClaim ? { unverifiedFileClaim } : {}),
    };
  if (drafts.length && !failures.size && !savedPaths.size && !staged.length)
    // The draft exists in Gmail and was not sent. Speak the receipt, not
    // the model's wording, so "sent" can never be spoken.
    return {
      text: `I've saved ${drafts.length === 1 ? "the draft" : `${drafts.length} drafts`} in Gmail. Nothing has been sent; the link to Drafts is in chat.`,
      corrected: true,
      savedPaths: [],
      filePaths: [...readPaths],
      dispatchedTaskIds: dispatched,
      stagedActionIds: staged,
      draftUrls: drafts,
      ...(unverifiedFileClaim ? { unverifiedFileClaim } : {}),
    };
  if (staged.length && !failures.size && !savedPaths.size)
    // The proposal exists; the action has not run. Never let the model's
    // prose promote "proposed" to "drafted" or "scheduled".
    return {
      text: `I've put ${staged.length === 1 ? "a proposal" : `${staged.length} proposals`} in chat for you to review. Nothing has run: tap Confirm on the card to run it, or Cancel.${dispatched.length ? " I also started a read-only background research task." : ""}`,
      corrected: true,
      savedPaths: [],
      filePaths: [...readPaths],
      dispatchedTaskIds: dispatched,
      stagedActionIds: staged,
      draftUrls: drafts,
      ...(unverifiedFileClaim ? { unverifiedFileClaim } : {}),
    };
  if (unverifiedFileClaim)
    return {
      text: "I couldn't verify the file link returned for that request. No report save was confirmed for it. Please retry in chat.",
      corrected: true,
      savedPaths: [...savedPaths],
      filePaths: [...savedPaths],
      dispatchedTaskIds: dispatched,
      stagedActionIds: staged,
      draftUrls: drafts,
      unverifiedFileClaim: true,
    };
  if (savedPaths.size)
    return {
      text: `Your report is saved in the workspace. I've added a link in chat.${failures.size ? " An additional step failed; check the chat for details." : ""}`,
      corrected: true,
      savedPaths: [...savedPaths],
      filePaths: [...savedPaths],
      dispatchedTaskIds: dispatched,
      stagedActionIds: staged,
      draftUrls: drafts,
    };
  if (failures.size)
    return {
      text: failures.has("spawn_background_task")
        ? "The background task did not start. No report was saved. Please retry the request; nothing is running in the background."
        : failures.has("gmail_email")
          ? "The Gmail step did not return a verified result. If it was a draft, check Gmail Drafts before asking again; it may already exist. Nothing was sent."
          : "I couldn't complete that request because a tool failed or was blocked. No report was saved. Please check the chat and retry.",
      corrected: true,
      savedPaths: [],
      filePaths: [],
      dispatchedTaskIds: dispatched,
      stagedActionIds: staged,
      draftUrls: drafts,
    };
  // Intermediate promises are not outcomes. Speak only the final text part.
  return {
    text:
      spokenText(finalText, readPaths) +
      (readPaths.size ? " I've added the file links in chat." : ""),
    corrected: false,
    savedPaths: [],
    filePaths: [...readPaths],
    dispatchedTaskIds: [],
    stagedActionIds: [],
    draftUrls: [],
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
    ...outcome.draftUrls.map((url) => `[Open Gmail Drafts](${url})`),
  ].join("\n\n");
}
