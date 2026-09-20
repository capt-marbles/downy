import type { DownyAgent } from "../DownyAgent";
import { tool } from "ai";
import { z } from "zod";
import { findToolSetup } from "../../composio/discovery";
export function createFindToolSetupTool(
  env: Cloudflare.Env,
  agent: DownyAgent,
) {
  return tool({
    description:
      "Find setup options for a service by name, searching Composio toolkits, known direct MCP endpoints, then vendor documentation. Results explicitly distinguish confirmed endpoints from guesses. Use the setup card to choose a small tool scope and authorize; never ask for keys in chat.",
    inputSchema: z.object({ query: z.string().min(1).max(200) }),
    execute: async ({ query }) => {
      const result = await findToolSetup(env, query, (name) =>
        agent.findManagedToolSetup(name),
      );
      if (
        result.candidates.some(
          (candidate) =>
            "toolkit" in candidate && candidate.toolkit === "airtable",
        )
      ) {
        await agent.showAirtableConnectCard();
        return {
          ...result,
          managedConnections: await agent.managedConnectionStatus(),
          nextAction:
            "The Airtable connect card is displayed. Stop and wait for the user to click Connect Airtable. It uses the existing Composio account OAuth. Do not ask for an MCP URL, project API key or token, and do not retry setup in this turn. The card confirms account identity before enabling base, schema and record reads.",
        };
      }
      if (
        result.candidates.some(
          (candidate) =>
            "toolkit" in candidate && candidate.toolkit === "gmail",
        )
      ) {
        await agent.showGmailConnectCard();
        return {
          ...result,
          managedConnections: await agent.managedConnectionStatus(),
          nextAction:
            "The Gmail connect card is displayed. Stop and wait for the user to click Connect Gmail. Do not connect an MCP URL, search for credentials, or try alternate endpoints. Composio account OAuth is separate from ordinary MCP server rows; an empty servers list does not mean it is disconnected.",
        };
      }
      return result;
    },
  });
}
