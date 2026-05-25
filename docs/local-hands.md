# Downy local hands skeleton

Local hands is the bridge between the Cloudflare-hosted Buildroom agent and tools that should run locally: shell, filesystem, browser automation, Xurl/Hermes, Jcode, and git.

This first version is intentionally a polling protocol skeleton. It gives Downy a durable queue, confirmation gates, connector heartbeat, claim, and completion semantics without granting any real local execution yet.

## Protocol

All requests are scoped by `X-Agent-Slug`, usually `buildroom`.

- `GET /api/local-hands`
  - Lists open actions and connector status.
- `POST /api/local-hands`
  - Body: `{ "kind": "jcode", "riskLevel": "read_only", "requiresConfirmation": false, "requestedBy": "...", "input": {...} }`
  - Creates a local hands action. Read-only requests can be queued immediately; higher-risk requests enter confirmation.
- `POST /api/local-hands/confirm`
  - Body: `{ "id": "...", "approved": true, "reason": "..." }`
  - Moves `pending_confirmation` to `queued`, or rejects it.
- `POST /api/local-hands/heartbeat`
  - Body: `{ "connectorId": "local-mac", "name": "Mac", "capabilities": [...] }`
- `POST /api/local-hands/claim`
  - Body: `{ "connectorId": "local-mac", "capabilities": [...] }`
  - Claims the oldest queued action.
- `POST /api/local-hands/:actionId/complete`
  - Body: `{ "connectorId": "local-mac", "status": "completed", "result": {...} }`

## Action lifecycle

```text
pending_confirmation -> queued -> claimed -> completed
                      -> rejected          -> failed
```

Read-only requests can be queued immediately if `requiresConfirmation=false`. Anything with local writes, external side effects, or destructive risk is forced through confirmation.

## Local skeleton daemon

```bash
DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
node scripts/downy-hands.mjs
```

If the app is behind Cloudflare Access, provide service token headers:

```bash
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
node scripts/downy-hands.mjs
```

The daemon heartbeats, claims, and completes actions. It currently includes a guarded `jcode` executor for `read_only` actions. Other kinds still return a skeleton placeholder result.

### Jcode executor

For `kind: "jcode"`, the daemon runs:

```bash
jcode run --json --quiet -C <workingDirectory> <read-only prompt>
```

Safety constraints in this first executor:

- Only accepts `riskLevel: "read_only"`.
- Injects a read-only instruction into the Jcode prompt.
- Restricts `workingDirectory` to `DOWNY_HANDS_ALLOWED_ROOTS`, defaulting to your home directory.
- Returns stdout/stderr and duration to Downy.

Useful environment variables:

```bash
DOWNY_HANDS_ALLOWED_ROOTS=/Users/awalker/downy:/Users/awalker/other-repo
DOWNY_HANDS_JCODE_BIN=jcode
DOWNY_HANDS_JCODE_TIMEOUT_MS=300000
DOWNY_HANDS_ONCE=1 # process one poll cycle, useful for smoke tests
```

## Mac Mini smoke test

Use this on the Mac Mini after pulling the Buildroom branch and installing dependencies. It creates one read-only Jcode action through Downy, runs the local hands daemon for one poll cycle, then verifies that the action was claimed by `mac-mini` and completed with a `jcode.read_only` result.

```bash
cd /path/to/downy
pnpm install

DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
DOWNY_HANDS_CONNECTOR_ID=mac-mini \
DOWNY_HANDS_ALLOWED_ROOTS=/Users/awalker/downy \
DOWNY_HANDS_SMOKE_WORKDIR=/Users/awalker/downy \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
pnpm hands:smoke
```

The smoke test requires `jcode` on `PATH`. Override it with `DOWNY_HANDS_JCODE_BIN=/path/to/jcode` if needed.

Expected result:

```text
Created queued action: hands-...
claimed hands-... (jcode, read_only)
Smoke test passed
```

If Cloudflare Access is configured and the service token is missing or wrong, the create/heartbeat requests will fail before any local execution.

## Agent tools

- `request_local_hands_action`
- `list_local_hands_actions`
- `confirm_local_hands_action`

Use `request_local_hands_action` for cloud-to-local work. The input should include a clear command/request and expected output. Example:

```json
{
  "kind": "jcode",
  "riskLevel": "read_only",
  "requiresConfirmation": false,
  "requestedBy": "buildroom",
  "input": {
    "task": "inspect repo and summarize test commands",
    "workingDirectory": "/Users/awalker/downy"
  }
}
```
