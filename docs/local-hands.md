# Downy local hands skeleton

Local hands is the bridge between the Cloudflare-hosted Buildroom agent and tools that should run locally: shell, filesystem, browser automation, Xurl/Hermes, Jcode, and git.

This first version is intentionally a polling protocol skeleton. It gives Downy a durable queue, confirmation gates, connector heartbeat, claim, and completion semantics without granting any real local execution yet.

## Protocol

All requests are scoped by `X-Agent-Slug`, usually `buildroom`.

- `GET /api/local-hands`
  - Lists open actions and connector status.
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

The skeleton daemon only heartbeats, claims, and completes actions with a placeholder result. Real executors should be added behind allowlists and confirmation checks in later steps.

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
