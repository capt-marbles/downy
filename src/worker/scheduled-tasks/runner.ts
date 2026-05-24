import { getAgentStub } from "../lib/get-agent";
import {
  listDueScheduledTasks,
  markScheduledTaskDispatched,
  markScheduledTaskFailed,
} from "./db";

export async function runDueScheduledTasks(env: Cloudflare.Env): Promise<{
  checkedAt: number;
  dispatched: number;
  failed: number;
}> {
  const checkedAt = Date.now();
  const due = await listDueScheduledTasks(env.DB, checkedAt);
  let dispatched = 0;
  let failed = 0;
  for (const task of due) {
    try {
      const agent = await getAgentStub(env, task.agentSlug);
      const { taskId } = await agent.dispatchScheduledTask({
        scheduleId: task.id,
        title: task.title,
        kind: task.kind,
        brief: task.brief,
      });
      await markScheduledTaskDispatched(env.DB, task, taskId, checkedAt);
      dispatched += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      await markScheduledTaskFailed(env.DB, task, message, checkedAt);
      console.error("[scheduled-tasks] dispatch failed", {
        id: task.id,
        agentSlug: task.agentSlug,
        error: message,
      });
    }
  }
  return { checkedAt, dispatched, failed };
}
