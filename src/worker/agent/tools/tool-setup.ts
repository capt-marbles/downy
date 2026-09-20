import type { DownyAgent } from "../DownyAgent";
import { tool } from "ai";
import { z } from "zod";
export function createFindToolSetupTool(agent: DownyAgent) {
  return tool({
    description:
      "Find setup options for a service by name, searching Composio toolkits, known direct MCP endpoints, then vendor documentation. Results explicitly distinguish confirmed endpoints from guesses. Use the setup card to choose a small tool scope and authorize; never ask for keys in chat.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      retry: z
        .boolean()
        .optional()
        .describe(
          "Retry unavailable discovery only when requested; the runbook limits attempts.",
        ),
    }),
    execute: ({ query, retry }) => agent.runServiceSetup(query, retry ?? false),
  });
}
