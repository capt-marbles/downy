import { getAgentByName } from "agents";
import { tool } from "ai";
import { z } from "zod";

import type { ChildAgent } from "../ChildAgent";
import type { BackgroundTaskRecord } from "../background-task-types";

const inputSchema = z.object({
  kind: z
    .string()
    .min(1)
    .default("task")
    .describe(
      "Optional category tag, e.g. 'research' or 'summarize-feed'. Defaults to 'task'; the brief carries the instructions.",
    ),
  brief: z
    .string()
    .min(10)
    .describe(
      "Self-contained instructions the background task worker will execute. Must be specific — the worker has no conversation history. Include the goal, any URLs or topics, and the desired output shape.",
    ),
});

export type BackgroundTaskDispatchDeps = {
  namespace: DurableObjectNamespace<ChildAgent>;
  parentName: string;
  putRecord: (taskId: string, record: BackgroundTaskRecord) => Promise<void>;
  broadcastUpdate: (record: BackgroundTaskRecord) => void;
};

/**
 * Record, broadcast and start one background task. Shared by the chat tool
 * below and the voice policy's read-only research dispatch so the record
 * shape and start sequence exist in one place.
 */
export async function dispatchBackgroundTask(
  deps: BackgroundTaskDispatchDeps,
  task: { kind: string; brief: string; access?: "full" | "read-only" },
): Promise<{ taskId: string; status: "dispatched" }> {
  const taskId = crypto.randomUUID();
  const record: BackgroundTaskRecord = {
    id: taskId,
    kind: task.kind,
    brief: task.brief,
    status: "running",
    ...(task.access ? { access: task.access } : {}),
    spawnedAt: Date.now(),
  };
  await deps.putRecord(taskId, record);
  deps.broadcastUpdate(record);
  const stub = await getAgentByName(deps.namespace, taskId);
  await stub.startTask({
    parentName: deps.parentName,
    taskId,
    kind: task.kind,
    brief: task.brief,
    ...(task.access ? { access: task.access } : {}),
  });
  return { taskId, status: "dispatched" };
}

export function createSpawnBackgroundTaskTool(
  args: BackgroundTaskDispatchDeps,
) {
  return tool({
    description: `Dispatch work to a separate background worker (its own durable object, its own LLM loop, its own \`execute\` sandbox). The worker inherits your connected MCP tools via RPC. Returns immediately with \`{ taskId, status: "dispatched" }\`; when the worker finishes you get a new turn pointing at the saved file.

Dispatch when: the work needs more than 2–3 tool calls, the result wants to land in a file, or the user shouldn't have to sit waiting. Don't dispatch quick bounded queries ("what's X", "find the docs link for Y") — call \`execute\` inline and answer in the same turn.

Match the brief to what's actually being asked. A "how do I set up X" brief should ask for concise practical steps (install command, env vars, gotchas). A "scan the competitive landscape" brief can ask for a structured report. Don't auto-upgrade every research-flavored ask into a full report. If the brief depends on a specific MCP server (DataForSEO, Linear, PostHog), name it so the worker knows to use those tools.`,
    inputSchema,
    execute: async ({ kind, brief }) =>
      dispatchBackgroundTask(args, { kind, brief }),
  });
}
