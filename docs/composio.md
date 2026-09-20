# Managed service setup

Provision `DOWNY_COMPOSIO_API_KEY` in Cloudflare Secrets Store with Workers scope,
then bind it to `COMPOSIO_API_KEY` on the Worker. Enter it only in the Cloudflare
secure form. `CREDENTIAL_KEY` uses the existing `DOWNY_CREDENTIAL_KEY` binding.
No key is accepted as a model tool argument or chat message.

Ask Downy to connect Gmail, or open Connected tools. The deterministic Gmail card
starts Composio's hosted Google authorization and shows the connection state.
Passwords and OAuth tokens stay with Google/Composio. The redirect link is encrypted
in agent storage, scoped to the verified Access subject and a 15-minute lifetime;
it is never put in the transcript. Reloading the page resumes the pending card.
Server-side polling continues after the browser closes and posts a credential-free
completion receipt to chat. Do not set a Downy callback URL or bypass Access.

The first Gmail pilot exposes only profile, email search and individual-message
reads. Sending, drafting, deletion and label changes are not enabled. The same
allowlist is enforced on the server, including requests from generic setup cards.
Google's consent page may show broader permissions than the tools Downy exposes;
review the consent screen before authorizing. A successful OAuth response is not
reported as connected until MCP discovery succeeds.

The integration calls REST v3.1 directly, without an SDK. It creates a session
pinned to the authorized account and explicit tools. Discovery, multi-execution,
connection management and workbench/proxy tools are disabled. The returned MCP URL
is attached through the existing encrypted-header persistence path. The existing
`server_id` column holds the Composio session ID; no new database migration is
needed. An authorization ticket expiring does not expire an established connection.

Other toolkit API-key flows continue to use the secure credential card. Tool
selections remain bounded to 12 and are validated against the toolkit catalog.
Failures return fixed messages, never provider response bodies or submitted values.

Acceptance: authorize the intended Google account, observe the completion receipt,
reload the chat, verify the three-tool scope, then ask for the connected Gmail
profile. Reading a message is a separate user task. No email is sent during setup.

References:

- https://docs.composio.dev/docs/sessions-via-mcp
- https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession
- https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink
