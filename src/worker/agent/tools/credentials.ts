import { tool } from "ai";
import { CredentialRequestInputSchema } from "../../credentials/types";
import { createCredentialRequest } from "../../credentials/requests";
export function createRequestCredentialTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Request secure credential entry in a private key card. Never ask the user to type a key, token, or password into chat. Confirm the vendor endpoint from documentation; this tool accepts field descriptions only, never secret values. Basic fields take username:password in the secure card.",
    inputSchema: CredentialRequestInputSchema,
    execute: (input) => createCredentialRequest(args.db, args.agentSlug, input),
  });
}
