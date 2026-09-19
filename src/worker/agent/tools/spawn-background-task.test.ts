import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createSpawnBackgroundTaskTool } from "./spawn-background-task";
import type { ChildAgent } from "../ChildAgent";

const startTask = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("agents", () => ({ getAgentByName: async () => ({ startTask }) }));

it("dispatches the user's valid brief when the model omits the optional category", async () => {
  const putRecord = vi.fn(async () => {});
  const dispatch = createSpawnBackgroundTaskTool({
    // The namespace is never dereferenced by the mocked DO resolver.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    namespace: {} as DurableObjectNamespace<ChildAgent>,
    parentName: "buildroom",
    putRecord,
    broadcastUpdate: vi.fn(),
  });
  if (!(dispatch.inputSchema instanceof z.ZodType))
    throw new Error("Expected Zod schema");
  const input = dispatch.inputSchema.parse({
    description:
      "Combine all four browser research captures into one summary report",
    brief:
      "Read all four files in workspace/research/browser. Synthesize a factual report with source URLs and evidence limits. Write workspace/research/combined-research-summary.md.",
  });
  const result = await dispatch.execute?.(
    z.object({ kind: z.string(), brief: z.string() }).parse(input),
    {
      toolCallId: "test",
      messages: [],
    },
  );
  expect(result).toMatchObject({ status: "dispatched" });
  expect(startTask).toHaveBeenCalledOnce();
  expect(putRecord).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ kind: "task", status: "running" }),
  );
});
