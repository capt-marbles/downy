# Buildroom handoff notes

Date: 2026-05-25
Target continuation environment: Andrew's Mac Mini, not this laptop.

## Current goal

Downy is being adapted into **Buildroom**: a single focused Downy install that can run Hermes/gkisokay-style workflows with distinct roles, typed artifacts, approvals, schedules, memory, and local execution hands.

Downy should be the hosted orchestrator, state/memory/artifact layer, schedule runner, and operator UI. Local machines provide capabilities that should not live inside Cloudflare Workers, such as Jcode, browser automation, Xurl/Hermes access to X, filesystem, git, and shell.

## Deployed install

Live URL:

- <https://downy.andrewdmwalker.workers.dev>

Fresh Buildroom-focused resources were created earlier:

- D1: `downy-buildroom-20260525`
- R2: `downy-buildroom-workspace-20260525`
- Active agent: `buildroom`
- Old `default` agent archived in fresh DB

## Current branch state

Recent commits to preserve/push:

- `2c2ef3a Add read-only Jcode local hands executor`
- `e5b3218 Add local hands protocol skeleton`
- `f6a96e0 Add Buildroom workflow engine`
- `99d09ee Use fresh buildroom data resources`
- Earlier commits include Buildroom spec/foundation and reset endpoint.

## Implemented Buildroom scope

### Workflow spec

File: `docs/buildroom-workflow-spec.md`

Captures the intended system scope:

- research -> idea -> review -> planning -> coding -> verification -> QA -> trust/retention -> closeout
- role-gated transitions
- typed artifacts
- approval ledger
- local hands integration
- safety and confirmation gates

### Buildroom foundation

Implemented schema/tools for jobs, lifecycle, artifacts, events, and Buildroom REST APIs.

Important files:

- `migrations/0004_buildroom.sql`
- `src/worker/buildroom/*`
- `src/worker/agent/tools/buildroom.ts`
- `src/worker/handlers/buildroom.ts`

Agent tools include:

- `create_buildroom_job`
- `list_buildroom_jobs`
- `write_buildroom_artifact`

### Workflow engine

Implemented reusable workflow templates, workflow runs, stage runs, and gate decisions.

Important files:

- `migrations/0005_buildroom_workflows.sql`
- `src/worker/buildroom/workflows.ts`
- `src/worker/buildroom/workflow-db.ts`
- `src/worker/agent/tools/buildroom-workflows.ts`

Agent tools include:

- `list_buildroom_workflow_templates`
- `create_buildroom_workflow_template`
- `start_buildroom_workflow`
- `get_buildroom_workflow`
- `advance_buildroom_workflow`
- `record_buildroom_gate_decision`

Deployment applied migration `0005_buildroom_workflows.sql`.

### Local hands skeleton

Implemented a polling-first local hands protocol for cloud-to-local work.

Important files:

- `migrations/0006_local_hands.sql`
- `src/worker/local-hands/types.ts`
- `src/worker/local-hands/db.ts`
- `src/worker/handlers/local-hands.ts`
- `src/worker/agent/tools/local-hands.ts`
- `scripts/downy-hands.mjs`
- `docs/local-hands.md`

Agent tools include:

- `request_local_hands_action`
- `list_local_hands_actions`
- `confirm_local_hands_action`

REST API:

- `GET /api/local-hands`
- `POST /api/local-hands/confirm`
- `POST /api/local-hands/heartbeat`
- `POST /api/local-hands/claim`
- `POST /api/local-hands/:actionId/complete`

Deployment applied migration `0006_local_hands.sql`.

## Local hands status and Mac Mini note

The first local hands daemon was added on this laptop, but the intended runtime should be Andrew's **Mac Mini**.

Current daemon command:

```bash
pnpm hands
```

Recommended Mac Mini setup:

```bash
cd /path/to/downy
pnpm install
DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
DOWNY_HANDS_CONNECTOR_ID=mac-mini \
DOWNY_HANDS_ALLOWED_ROOTS=/Users/awalker \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
pnpm hands
```

Cloudflare Access currently protects `/api/local-hands`. This laptop did not have a service token in env, so live curl smoke test got a `302` to Access, which is expected protection but not a full queue execution smoke test. A continuation session on the Mac Mini should create/provide a Cloudflare Access service token for this daemon, then run the full heartbeat -> claim -> complete test.

## Jcode executor status

`scripts/downy-hands.mjs` now includes a guarded read-only `jcode` executor.

For actions with:

```json
{
  "kind": "jcode",
  "riskLevel": "read_only",
  "requiresConfirmation": false,
  "input": {
    "task": "inspect repo and summarize test commands",
    "workingDirectory": "/Users/awalker/downy"
  }
}
```

The daemon runs:

```bash
jcode run --json --quiet -C <workingDirectory> <read-only prompt>
```

Safety constraints:

- only accepts `riskLevel: "read_only"`
- injects explicit read-only instructions
- restricts working directory to `DOWNY_HANDS_ALLOWED_ROOTS`
- returns stdout/stderr/duration to Downy

Caveat: this is instruction-level read-only, not OS-level sandboxing. Next step should improve enforcement by using a sandbox, separate checkout, or permission policy before allowing any write-capable Jcode task.

## Validation already run

Before handoff:

```bash
pnpm run lint
pnpm run types:check
pnpm run format:check
node --check scripts/downy-hands.mjs
```

All passed.

Deploys completed successfully for workflow engine and local hands migrations.

## Recommended next session tasks on Mac Mini

1. Pull latest from fork.
2. Configure Cloudflare Access service token for local hands.
3. Run `pnpm hands` on Mac Mini with `DOWNY_HANDS_CONNECTOR_ID=mac-mini`.
4. From Downy/Buildroom, create a read-only `jcode` local hands action.
5. Verify the Mac Mini daemon heartbeats, claims, runs Jcode, and completes the action.
6. Add UI/operator surface for pending local hands confirmations.
7. Add stronger local sandboxing for Jcode and shell before enabling writes.
8. Add next executors in order:
   - Xurl/Hermes research connector
   - browser automation
   - git read, then gated git write
   - shell/filesystem read, then gated writes

## Do not continue from this laptop unless intentional

The user clarified the local hands runtime should be designed for the Mac Mini. Treat this laptop work as protocol/bootstrap code only. Avoid installing long-running launch agents or storing local execution credentials here.
