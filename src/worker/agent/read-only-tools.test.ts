import { tool } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { readOnlyActiveTools, readOnlyToolSet } from "./read-only-tools";

function fixture(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        inputSchema: z.object({}),
        execute: async () => `${name} ran`,
      }),
    ]),
  );
}

it("keeps only research and read tools executable for a read-only worker", async () => {
  const tools = readOnlyToolSet(
    fixture([
      "web_search",
      "web_scrape",
      "read_peer_agent",
      "read",
      "list",
      "find",
      "grep",
      "read_skill",
      "list_skills",
      "list_skill_files",
      "todo_write",
      "write",
      "edit",
      "delete",
      "move",
      "copy",
      "create_skill",
      "update_skill",
      "delete_skill",
      "request_local_hands_action",
      "tool_gmail_send",
    ]),
  );
  expect(readOnlyActiveTools(tools)).toEqual([
    "web_search",
    "web_scrape",
    "read_peer_agent",
    "read",
    "list",
    "find",
    "grep",
    "read_skill",
    "list_skills",
    "list_skill_files",
    "todo_write",
  ]);
  expect(
    await tools.web_search.execute?.({}, { toolCallId: "s", messages: [] }),
  ).toBe("web_search ran");
  for (const name of [
    "write",
    "edit",
    "delete",
    "move",
    "copy",
    "create_skill",
    "update_skill",
    "delete_skill",
    "request_local_hands_action",
    "tool_gmail_send",
  ]) {
    // Blocked tools keep their name so Think's merge cannot restore the
    // original executor, and they throw instead of reaching the workspace.
    expect(tools[name]).toBeDefined();
    await expect(
      tools[name].execute?.({}, { toolCallId: name, messages: [] }),
    ).rejects.toThrow("read-only");
  }
});
