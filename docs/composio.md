# Managed service setup

Provision `DOWNY_COMPOSIO_API_KEY` in Cloudflare Secrets Store. The Worker binding
is `COMPOSIO_API_KEY`; neither the model nor the browser receives its value.
`find_tool_setup` checks Composio's v3 toolkit list, a short direct-MCP registry,
then Exa for vendor documentation. Search results are explicitly guesses until
verified. No Composio SDK is installed.

The chat setup card lets the operator choose up to 12 tools. The server validates
the selection against the toolkit and creates a scoped MCP server with explicit
`allowed_tools`. OAuth users are keyed by their verified Cloudflare Access subject.
API-key toolkits reuse the credential card and post their fields to Composio;
Downy stores connection metadata only. The Composio MCP `x-api-key` header uses
the same encrypted persistence as direct MCP credentials.

Managed OAuth uses `POST /api/v3/connected_accounts/link`: Composio retired the
older managed-OAuth `POST /connected_accounts` flow. API-key initiation still uses
that endpoint. The Authorize button opens Composio's hosted flow; no Downy callback
URL or Access bypass is introduced. UI polling calls Downy, which checks Composio
server-side and registers the per-user MCP endpoint when the account is ACTIVE.

The requested `/v3/mcp/<server_id>?user_id=...` API is currently documented as
legacy. It is retained to match this integration's explicit scope and fixed tool
surface. No live OAuth account or MCP server was created during implementation.
