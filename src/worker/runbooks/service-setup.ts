import type { findToolSetup } from "../composio/discovery";
import { resolveService, SERVICES } from "./service-registry";
type Discovery = Awaited<ReturnType<typeof findToolSetup>>;
export type SetupVerification = {
  state: string;
  authorized: boolean;
  identity?: string | null;
  readVerified: boolean;
  operations: string[];
  channels: string[];
  checkedAt: number;
};
export type SetupCheckpoint = {
  version: 1;
  query: string;
  service: string;
  step: string;
  attempts: number;
  discoveryWindowStartedAt?: number;
  updatedAt: number;
  discovery?: Discovery;
  verification?: SetupVerification;
  nextAction: string;
};
type Deps = {
  load: (service: string) => Promise<SetupCheckpoint | undefined>;
  save: (checkpoint: SetupCheckpoint) => Promise<void>;
  verify: (service: string) => Promise<SetupVerification | null>;
  discover: (query: string) => Promise<Discovery>;
  showCard: (service: string) => Promise<void>;
  now?: () => number;
};
function serviceName(query: string) {
  const known = resolveService(query);
  if (known) return known.id;
  if (/^(connect\s+)?composio$/i.test(query.trim())) return "composio";
  return query
    .trim()
    .toLowerCase()
    .replace(/^(?:connect|set up|link)\s+(?:to\s+|my\s+)?/, "")
    .slice(0, 200);
}

export async function runServiceSetup(
  query: string,
  retry: boolean,
  deps: Deps,
) {
  const now = deps.now ?? Date.now;
  const service = serviceName(query);
  const previous = await deps.load(service);
  const checkpoint: SetupCheckpoint = previous ?? {
    version: 1,
    query,
    service,
    step: "checking",
    attempts: 0,
    updatedAt: now(),
    nextAction: "",
  };
  const finish = async (step: string, nextAction: string) => {
    checkpoint.step = step;
    checkpoint.nextAction = nextAction;
    checkpoint.updatedAt = now();
    await deps.save(checkpoint);
    return {
      runbook: checkpoint,
      candidates: checkpoint.discovery?.candidates ?? [],
      warnings: checkpoint.discovery?.warnings ?? [],
      nextAction,
    };
  };
  // Always check authorization before discovery, including after hibernation.
  // A verification error must never restart authorization or leak provider text.
  try {
    const verified = await deps.verify(service);
    if (verified) {
      checkpoint.verification = verified;
      if (verified.authorized && verified.readVerified)
        return finish(
          "verified",
          "Connection identity and a minimal read are verified. Report only the listed operations and channels; do not request another sign-in.",
        );
      if (verified.state === "attached")
        return finish(
          "awaiting_read_verification",
          "An MCP server is already attached. Confirm the intended account and select a minimal read operation from its listed tools before claiming verified access. Do not reconnect automatically.",
        );
      if (verified.authorized && verified.state === "verification_failed")
        return finish(
          "verification_failed",
          "Authorization exists but the minimal read failed. No verified access yet. Check the existing connection card or retry once after the service recovers.",
        );
      if (["pending", "needs_selection"].includes(verified.state)) {
        await deps.showCard(service);
        return finish(
          "awaiting_authorization",
          "Stop and wait for the existing secure card. Resume this runbook after authorization; do not restart discovery or ask for credentials.",
        );
      }
    }
  } catch {
    delete checkpoint.verification;
    return finish(
      "verification_failed",
      "Connection status could not be verified. Retry later; do not claim disconnection or request credentials.",
    );
  }
  const spec = SERVICES.find((entry) => entry.id === service) ?? null;
  const connectable = [
    "Gmail and Airtable connect through secure cards in chat",
    "Treg connects as an MCP server",
  ].join("; ");
  if (spec && (spec.flow === "not-connectable" || spec.status === "planned"))
    return finish(
      "not_available",
      `${spec.label} cannot be connected from Downy yet. ${spec.note} Tell the user this plainly in one or two sentences and mention what can be connected (${connectable}). Do not present candidates, do not ask which option they want, and do not call find_tool_setup again for ${spec.label} in this conversation.`,
    );
  if (spec?.flow === "mcp" && spec.mcp)
    return finish(
      "connect_mcp",
      `${spec.label} connects as an MCP server. Call connect_mcp_server with name "${spec.id}", url ${spec.mcp.url} and transport ${spec.mcp.transport}; authorization happens in the browser and no key is typed in chat: when the result is authenticating, put its authUrl in chat as a link labelled Authorize ${spec.label} and say the same button is on the agent's MCP page; do not call connect_mcp_server again while it is pending. After it connects, run one minimal read (${spec.operations[0] ?? "a listed read tool"}) before claiming access. ${spec.note}`,
    );
  const managedCard =
    service === "composio" ||
    (spec?.flow === "composio-managed" && spec.status === "available");
  if (previous && !retry && checkpoint.discovery) {
    if (managedCard) {
      await deps.showCard(service);
      return finish(
        "awaiting_authorization",
        "Stop and wait for the secure connection card. Authorization and the minimal read must succeed before claiming access.",
      );
    }
    return {
      runbook: checkpoint,
      candidates: checkpoint.discovery.candidates,
      warnings: checkpoint.discovery.warnings,
      nextAction: checkpoint.nextAction,
    };
  }
  if (
    retry &&
    now() - (checkpoint.discoveryWindowStartedAt ?? checkpoint.updatedAt) >=
      15 * 60_000
  ) {
    checkpoint.attempts = 0;
    checkpoint.discoveryWindowStartedAt = now();
  }
  if (checkpoint.attempts >= 3)
    return finish(
      "needs_instructions",
      "Discovery reached its three-attempt budget. Ask for the vendor's official setup documentation or clarify the service. Do not guess URLs or ask for secrets.",
    );
  checkpoint.discoveryWindowStartedAt ??= now();
  checkpoint.attempts++;
  // Persist before network work so an interrupted attempt is still counted.
  await finish("discovering", "Checking setup options.");
  try {
    checkpoint.discovery = await deps.discover(query);
  } catch {
    checkpoint.discovery = {
      candidates: [],
      warnings: ["Setup discovery unavailable"],
    };
  }
  if (managedCard && checkpoint.discovery.candidates.length) {
    await deps.showCard(service);
    return finish(
      "awaiting_authorization",
      "Stop and wait for the secure connection card. Do not ask for an MCP URL, API key or token. Resume after authorization to verify a minimal read.",
    );
  }
  if (checkpoint.discovery.candidates.length)
    return finish(
      "candidate_found",
      `Downy has no connection flow for this service yet; the candidates below are documentation, not something you can connect. Tell the user it cannot be connected from chat today and what can be (${connectable}). Do not ask them to pick a candidate, never guess an endpoint or request secrets, and do not call find_tool_setup again for it in this conversation.`,
    );
  return finish(
    checkpoint.discovery.warnings.length
      ? "discovery_unavailable"
      : "needs_instructions",
    checkpoint.discovery.warnings.length
      ? "Lookup was unavailable; this is not evidence that the connector does not exist. Ask for official setup documentation or retry discovery with retry:true when requested. Never guess a URL."
      : "No candidate was found in this lookup. Ask for the vendor's official setup documentation or clarify the service; do not ask for credentials.",
  );
}
