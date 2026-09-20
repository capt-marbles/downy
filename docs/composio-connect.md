# Composio account connection

The Composio card in chat and Preferences share the signed-in Cloudflare Access
user's connection status. **Connect** opens Composio sign-in in a new tab. The
callback returns to the initiating conversation and adds a credential-free
receipt. No project API key is required for this OAuth path.

Downy discovers Composio's protected-resource and authorization-server metadata,
registers a public client, and uses Authorization Code with PKCE S256. Callback
state is user-bound, one-time, and expires after 15 minutes. Both start and
callback stay behind Cloudflare Access. Tokens, refresh tokens and pending PKCE
state are envelope-encrypted with the existing `CREDENTIAL_KEY` Secrets Store
binding, in an internal user-scoped Durable Object. Browser access to those
internal objects is blocked. Refreshes and callbacks are serialized; tokens
survive Worker/DO restarts and refresh automatically when nearing expiry.

Connected means an authenticated MCP initialize and tool-list check succeeded.
The card shows when that check was performed; it is not a continuous health
probe. Signing in does **not** expose Composio's broad execution/workbench tools
to the model or authorize Gmail. Gmail authorization and a narrow read/draft
allowlist are a separate step. No sending capability is enabled here.

**Disconnect from Downy** removes the local encrypted session. To revoke the
provider's authorization too, remove Downy from your Composio account.

The existing project-API-key integration remains available for installations
using scoped Composio toolkit sessions. It is separate from this account OAuth
connection. No new binding, database migration, or dependency is needed.
