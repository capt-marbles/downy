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

## Gmail through conversation

Ask Downy to connect Gmail. `find_tool_setup` displays the Gmail card and ends
that setup turn; it does not initiate authorization. The card's **Connect Gmail**
POST uses the already connected Composio account, calls the managed Gmail flow,
and opens Composio's hosted Google authorization. Merely viewing a card never
starts OAuth. No project API key or guessed MCP endpoint is involved.

After consent, Downy checks connection status and the Gmail profile, displays the
mailbox address and appends a verified receipt. The bot receives one narrow
`gmail_email` tool: search, read, and create draft. Its strict schema and server
mapping do not support sending, forwarding, deleting, other mailboxes, generic
Composio execution or workbench access. Draft creation is not automatically
retried after ambiguous failures. The user sends from Gmail. Google consent may
show broader scopes; the no-send restriction is enforced in Downy code.

If Composio returns multiple active Gmail accounts, the card says **Gmail is
authorized** and presents mailbox choices. This is a selection step, not an OAuth
failure. Downy never guesses from Composio's default account. The authenticated
selection POST checks that the account belongs to this user's active connections,
verifies its profile, and persists its ID encrypted. Every subsequent profile,
read and draft call includes that explicit `account` ID. Reloading the card or
changing the provider's default cannot silently switch mailboxes.

`list_mcp_servers` now returns `managedConnections` as well as ordinary `servers`.
An empty ordinary-server array does not mean Composio OAuth failed. Managed
status is synchronized by the authenticated cards and includes its last check.
The existing encrypted per-user vault persists the Gmail session; the bot stores
only a server-side reference after its Connect button is clicked. Other bots do
not inherit Gmail access.
