import { getAgentByName } from "agents";

import type { DownyAgent } from "../agent/DownyAgent";

const SLUG_REGEX = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED_SLUGS = new Set(["profile", ""]);

export function isValidSlug(slug: string): boolean {
  if (!SLUG_REGEX.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  if (slug.startsWith("__")) return false;
  return true;
}

/** Resolve one explicit agent scope, shared by all per-agent HTTP APIs.
 * URL scope survives dropped custom headers and separates browser resource URLs.
 * Header-only callers (including local hands) remain supported.
 */
export function slugFromRequest(request: Request): string {
  const slugs = new URL(request.url).searchParams.getAll("agentSlug");
  const header = request.headers.get("X-Agent-Slug");
  const slug = slugs[0] ?? header;
  if (!slug || !isValidSlug(slug) || slugs.length > 1) {
    throw new AgentSlugError(
      "An explicit valid agent slug is required",
      "invalid_slug",
      400,
    );
  }
  if (header && header !== slug) {
    throw new AgentSlugError(
      "URL and agent header disagree",
      "invalid_slug",
      400,
    );
  }
  return slug;
}

type AgentSlugErrorCode = "invalid_slug" | "unknown_agent" | "archived_agent";

export class AgentSlugError extends Error {
  constructor(
    message: string,
    readonly code: AgentSlugErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentSlugError";
  }
}

/**
 * Get a typed stub for the DownyAgent DO with the given slug. Uses
 * `getAgentByName` (not `env.DownyAgent.get(idFromName(...))`) because the
 * agent's underlying partyserver `Server` requires `.setName()` to be called
 * on the stub before `.name` is readable inside the DO. `routeAgentRequest`
 * does that for the chat path; on direct RPC entry points we have to go
 * through `getAgentByName`, which sets the name for us.
 *
 * The slug is the DO name. Workspace files in R2 are namespaced by `this.name`,
 * so each agent gets fully isolated storage automatically.
 */
export async function getAgentStub(
  env: Cloudflare.Env,
  slug: string,
): Promise<DurableObjectStub<DownyAgent>> {
  return getAgentByName<Cloudflare.Env, DownyAgent>(env.DownyAgent, slug);
}
