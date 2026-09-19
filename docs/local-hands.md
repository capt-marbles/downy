# Downy local hands

Local hands is the bridge between the Cloudflare-hosted Buildroom agent and tools that should run locally: shell, filesystem, browser automation, Xurl/Hermes, Grok/SuperGrok, Codex, and git.

The polling protocol gives Downy a durable queue, confirmation gates, connector heartbeat, claim, and completion semantics with guarded local execution.

## Protocol

All requests are scoped by `X-Agent-Slug`, usually `buildroom`.

- `GET /api/local-hands`
  - Lists open actions and connector status.
- `POST /api/local-hands`
  - Body: `{ "kind": "codex", "riskLevel": "read_only", "requiresConfirmation": false, "requestedBy": "...", "input": {...} }`
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

## Local daemon

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

The daemon heartbeats, claims, and completes actions. It currently includes a guarded `codex` executor for `read_only` actions. It advertises only enabled executors; unsupported kinds fail instead of returning placeholder success.

### Codex executor

For `kind: "codex"`, the daemon runs:

```bash
codex exec --sandbox read-only --skip-git-repo-check --output-last-message <tmpfile> "<task>"
```

Safety constraints in this first executor:

- Only accepts `riskLevel: "read_only"`.
- Passes the task unchanged. The read-only sandbox enforces the constraint.
- Restricts `workingDirectory` to `DOWNY_HANDS_ALLOWED_ROOTS`, defaulting to your home directory.
- Returns stdout/stderr and duration to Downy.

Useful environment variables:

```bash
DOWNY_HANDS_ALLOWED_ROOTS=/Users/awalker/downy:/Users/awalker/other-repo
DOWNY_HANDS_CODEX_BIN=codex
DOWNY_HANDS_CODEX_TIMEOUT_MS=300000
DOWNY_HANDS_ONCE=1 # process one poll cycle, useful for smoke tests
```

## Mac Studio smoke test

Use this on the Mac Studio after pulling main and installing dependencies. It creates one read-only Codex action through Downy, runs the local hands daemon for one poll cycle, then verifies that the action was claimed by `mac-studio` and completed with a `codex.read_only` result.

```bash
cd /path/to/downy
pnpm install

DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
DOWNY_HANDS_CONNECTOR_ID=mac-studio \
DOWNY_HANDS_ALLOWED_ROOTS=/Users/awalker/downy \
DOWNY_HANDS_SMOKE_WORKDIR=/Users/awalker/downy \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
pnpm hands:smoke
```

The smoke test requires `codex` on `PATH`. Override it with `DOWNY_HANDS_CODEX_BIN=/path/to/codex` if needed.

Expected result:

```text
Created queued action: hands-...
claimed hands-... (codex, read_only)
Smoke test passed
```

If Cloudflare Access is configured and the service token is missing or wrong, the create/heartbeat requests will fail before any local execution.

### Grok / X research executor

For `kind: "grok.research"` or `kind: "x.research"`, the daemon calls a local command configured by:

```bash
DOWNY_HANDS_GROK_RESEARCH_CMD=/path/to/grok-research-adapter
```

This command should run on the Mac Studio or Omarchy PC where your Premium+/SuperGrok/X session is available. Downy does **not** receive or store X credentials.

Downy includes a portable adapter wrapper at `scripts/grok-research-adapter.mjs`. It normalizes JSON or plain-text output from a lower-level local research command into Campaign Room `campaign-source-notes` shape.

Smoke the adapter without live X/Grok access:

```bash
pnpm grok:adapter:smoke
```

Run local hands with the bundled adapter in fixture mode:

```bash
DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
DOWNY_HANDS_CONNECTOR_ID=mac-studio \
DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
DOWNY_GROK_ADAPTER_FIXTURE=1 \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
pnpm hands
```

Run it against a real local provider command, for example a Hermes/Xurl/Grok browser adapter:

```bash
DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
DOWNY_GROK_ADAPTER_CMD=/path/to/your/local-x-or-grok-command \
pnpm hands
```

The provider command receives the same environment variables listed below and should print either the suggested JSON shape or plain text with source URLs. The wrapper normalizes either form.

When a Campaign Room smoke action includes `context.jobId` and `outputArtifact=campaign-source-notes`, `scripts/downy-hands.mjs` writes the completed research back to `/api/campaign-room/artifacts`, replacing the placeholder source-notes artifact.

Mac Studio notes:

- Use `DOWNY_HANDS_CONNECTOR_ID=mac-studio`.
- Keep `DOWNY_HANDS_ALLOWED_ROOTS` narrow, for example `/Users/awalker/downy`.
- Use the local command that has access to your authenticated browser/X/Grok session.

Omarchy PC notes:

- Use `DOWNY_HANDS_CONNECTOR_ID=omarchy`.
- Use Linux paths, for example `DOWNY_HANDS_ALLOWED_ROOTS=/home/awalker/downy`.
- Keep the provider command read-only. Browser automation is allowed for research, but not posting or account mutation.

The daemon passes the request through environment variables:

```bash
DOWNY_GROK_RESEARCH_JSON
DOWNY_GROK_RESEARCH_QUERY
DOWNY_GROK_RESEARCH_MODE
DOWNY_GROK_RESEARCH_MAX_RESULTS
DOWNY_GROK_RESEARCH_OUTPUT_ARTIFACT
DOWNY_GROK_RESEARCH_CONTEXT
```

The adapter should print JSON to stdout when possible. Suggested output shape:

```json
{
  "summary": "What Grok/X found",
  "sources": [
    { "url": "https://x.com/...", "title": "...", "source_type": "x" }
  ],
  "claims": ["Source-backed claim"],
  "opportunities": ["GTM/content/lead opportunity"],
  "open_questions": ["What still needs checking"],
  "research_limits": "What was searched and what was not"
}
```

Safety constraints:

- Only `read_only` Grok/X research actions are accepted.
- No posting, replying, liking, DMing, following, emailing, or CRM mutation.
- Use your authenticated local browser/session or local Xurl/Hermes adapter, but do not export credentials to Downy.
- Any future external side effect must be a separate action with explicit operator confirmation.

## Agent tools

- `request_local_hands_action`
- `request_grok_research`
- `list_local_hands_actions`
- `confirm_local_hands_action`

Use `request_local_hands_action` for cloud-to-local work. The input should include a clear command/request and expected output. Example:

```json
{
  "kind": "codex",
  "riskLevel": "read_only",
  "requiresConfirmation": false,
  "requestedBy": "buildroom",
  "input": {
    "task": "inspect repo and summarize test commands",
    "workingDirectory": "/Users/awalker/downy"
  }
}
```

## Codex authentication and sandbox

Run `codex login` once on each machine, or set `CODEX_API_KEY` in the daemon environment.
Downy does not read, store, or forward credentials. The child inherits the operator's
normal process environment. `codex exec` defaults to a read-only sandbox; the daemon
also passes `--sandbox read-only` explicitly. On macOS, Seatbelt and
`DOWNY_HANDS_ALLOWED_ROOTS` are independent checks and both apply. The validated
working directory is passed through `execFile`'s `cwd`, not a CLI flag.
Codex normally requires a Git repository; `--skip-git-repo-check` lets known, allowed
non-repository folders be inspected. Actions above `read_only` remain rejected.

`DOWNY_HANDS_CODEX_BIN` defaults to `codex`; `DOWNY_HANDS_CODEX_TIMEOUT_MS` defaults
to `300000`. The final message is read from a temporary file that is removed even
on failure; results retain stderr and elapsed duration.

Connectors send `allowedRoots` on heartbeat and claim. Use `targetConnectorId` to
pin work to `mac-studio` or `mac-laptop`; optional `expiresAt` is an epoch in
milliseconds. Scheduled child requests default to a 24-hour lifetime.

## Retrieve a known file

`filesystem.fetch` takes `{ sourcePath: "/absolute/known/file.pdf", destName?: "report.pdf" }`.
It always requires operator confirmation, even for `read_only` and even when a
caller sets `requiresConfirmation: false`: copying local bytes to the cloud is an
external side effect. This pulls a specific known file into a workflow; it is
**not a general remote file browser**.

The connector resolves symlinks before checking allowed roots and refuses
non-regular files. `DOWNY_MAX_FETCH_BYTES` defaults to 25 MiB (26,214,400 bytes) on
both Worker and connector. Oversized files fail locally before an upload. Raw
bytes stream to `POST /api/local-hands/:actionId/upload`; only the claiming
connector for a confirmed, claimed fetch can upload. No base64 or D1 byte storage.
The Worker independently enforces the cap and computes a digest; the connector
verifies it against its own SHA-256.

Files appear in `workspace/inbox/<connector-id>/` in the existing workspace browser,
including on a phone. Name collisions receive `-2`, `-3`, etc. before the extension.
The result contains `workspacePath`, `bytes`, `sha256`, `contentType`, and `sourcePath`.

## Studio browser research from iPhone

Open the agent chat and expand **Studio browser** above the call/composer controls.
Choose **Search X**, enter a query, and tap **Research on Studio**. Use
`from:trycua CUA-S1` as a known-source smoke test, then try
`AI (gamedev OR "game development") -filter:replies` for the pilot.
The panel shows queued, reading, completed and failed requests, including when
Studio is offline. Open the report when finished; it is also linked in chat.
The agent can read the saved sources with its existing workspace tools.

`x.research` accepts `{ query, maxResults? }` (1–20, default 10).
`browser` accepts `{ url }` for a specific X post or a public source page.
These operations require `read_only`, default to `mac-studio`, and expire after
24 hours if unstarted. Existing confirmation requests remain gated.
`request_grok_research` is retained as the agent shortcut but now queues an Aside
X search, not a Grok model call. No extra agent tools are registered.

Enable the local adapter on the Studio that holds the intended Aside profile:

```bash
DOWNY_HANDS_CONNECTOR_ID=mac-studio \
DOWNY_HANDS_ASIDE_ENABLED=1 \
DOWNY_HANDS_BROWSER_ONLY=1 \
DOWNY_HANDS_X_ACCOUNT=gogameye \
node scripts/downy-hands.mjs
```

Node 24+ and the Aside CLI must be on PATH. Aside must be running and signed into
X as the configured account. Optional `DOWNY_HANDS_ASIDE_BIN` pins the executable.
`DOWNY_HANDS_BROWSER_ONLY=1` advertises only browser/X capabilities, avoiding
unrelated jobs during this pilot. Otherwise filesystem fetch and Codex are
advertised too, plus Grok only when its command is configured. Run only one daemon
per connector/agent pair.

The adapter uses a fixed, bounded read program with a 60-second deadline. Input
cannot supply code, selectors or clicks. It checks the X account, captures
observed canonical post links, and closes its own tab. It never posts, likes,
follows, sends DMs, or exports cookies. X searches use Latest and collect only
rendered posts; this is not an exhaustive monitor or claim verification. Empty
results count as success only when X explicitly reports no results. A missing
page, login challenge or account mismatch is a visible failure.

Public reads default to github.com, huggingface.co, developers.cloudflare.com,
developers.openai.com, openai.com, typesafe.ai and cua.ai. Operators can replace
this exact-host list using comma-separated `DOWNY_HANDS_BROWSER_HOSTS`. X reads
remain limited to search and post URLs. Page text is untrusted evidence and does
not authorize subsequent actions. Redirects to another origin are rejected.

Results are saved as Markdown and JSON under
`workspace/research/browser/<action-id>.*`. A deterministic chat receipt links
the report; completion does not start another model turn automatically.

For an interactive pilot behind Access, run:

```bash
cloudflared access login https://downy.andrewdmwalker.workers.dev
DOWNY_HANDS_ACCESS_SESSION=1 node scripts/downy-hands.mjs
```

Use the same browser settings above. The daemon reads cloudflared's local token
cache without logging the token; no browser cookie extraction or Access bypass
is used. When the session expires, sign in again on Studio. This session-based
pilot is not permanent unattended authentication. Service-token operation needs
an Access policy and Worker identity validation that accept the chosen service
identity; configuring that is separate from this pilot.

Heartbeats continue during reads. Completed receipts are atomically saved with
owner-only permissions in `~/.local/state/downy-hands/<connector>/<agent>/`
(or `DOWNY_HANDS_STATE_DIR`) before delivery. Network failures retry delivery
without rerunning the browser. A restart during execution reports interruption
and requires an explicit new request. A crash between server claim and writing
the local receipt can still leave a claimed job requiring operator recovery;
the UI flags slow claimed jobs instead of pretending they completed. Do not run
two processes with the same connector ID or erase pending receipts.
