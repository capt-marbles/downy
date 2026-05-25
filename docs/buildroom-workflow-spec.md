# Downy Buildroom Workflow Spec

Status: draft implementation spec  
Date: 2026-05-25  
Source pattern: Graeme / gkisokay Substack article, "How to Build a Hermes Agent That Finds Important Work and Builds It Autonomously"

## 1. Goal

Bring Downy up to spec to run a Hermes-style autonomous workflow where separate agents can:

1. gather evidence,
2. notice candidate opportunities,
3. review and approve bounded work,
4. implement only approved plans,
5. verify independently,
6. summarize trust and retention state,
7. expose the full chain to an operator.

Downy should become the hosted runtime, scheduler, memory layer, tool layer, and operator UI for this workflow. Hermes/buildroom is the design pattern, not a second runtime dependency.

## 2. Design thesis

Downy already has the runtime primitives:

- Cloudflare-hosted Durable Object agents.
- Named agents with separate identity, memory, workspace, and skills.
- Scheduled tasks through Cloudflare cron and D1.
- Background child agents.
- Workspace-backed artifacts.
- MCP/tool integration.
- Sidebar/operator surfaces.
- Model status and turn diagnostics.

What is missing is workflow semantics:

- typed handoff artifacts,
- role-gated state transitions,
- approval ledger,
- verification delta,
- trust and retention reports,
- buildroom operator view,
- local hands integration for tools that should not live in Workers.

This spec adds those semantics inside Downy.

## 3. Non-goals

This phase does not attempt to:

- copy private Hermes runtime paths or profiles,
- depend on a Hermes installation,
- give cloud agents arbitrary shell access,
- let agents autonomously deploy or delete without confirmation,
- implement a full local Jcode/Xurl bridge before workflow contracts exist,
- replace existing Downy chat/task UX.

The first milestone should be boring, local, schema-backed, and auditable.

## 4. User-facing outcome

A user can open a Downy agent and see a Buildroom / Control Room page showing:

- active jobs,
- current lifecycle stage,
- owning role,
- missing receipts,
- risk band,
- approval status,
- verification status,
- QA delta,
- trust state,
- retention recommendation,
- timeline of workflow events.

Agents can run scheduled research and idea generation, but code/build execution only happens after explicit Main approval.

## 5. Conceptual role mapping

| gkisokay / Hermes role | Downy role                                          | Responsibility                                                                         |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Research               | Downy research agent                                | Collects evidence and writes `research-input.json`.                                    |
| Dreamer / Auto-think   | Downy dreamer agent                                 | Notices patterns and writes `idea-contract.json`. Cannot approve.                      |
| Intent reviewer        | Downy main or reviewer agent                        | Filters weak or unsafe ideas with `intent-review.json`.                                |
| Main                   | Downy main agent                                    | Approves or blocks work and writes `main-review.json` and `product-plan.json`.         |
| Coder                  | Downy child agent initially, local Jcode hand later | Writes `build-plan.json`, implements inside allowed scope, writes `verification.json`. |
| QA                     | Downy QA agent                                      | Independently verifies and writes `qa-verification.json`.                              |
| Verification delta     | Downy workflow engine/tool                          | Compares Coder and QA receipts into `verification-delta.json`.                         |
| Trust                  | Downy trust agent                                   | Summarizes room health in `trust-report.json`.                                         |
| Retention              | Downy retention agent                               | Recommends keep/improve/park/prune in `retention-review.json`.                         |
| Operator               | Downy UI                                            | Renders buildroom state and missing evidence.                                          |

## 6. Buildroom storage model

Use agent workspace files for human-readable receipts and D1 for indexed/queryable job state.

### 6.1 Workspace layout

Each agent gets a buildroom area under its workspace:

```text
workspace/buildroom/
  README.md
  schemas/
    research-input.schema.json
    idea-contract.schema.json
    intent-review.schema.json
    main-review.schema.json
    product-plan.schema.json
    build-plan.schema.json
    verification.schema.json
    qa-verification.schema.json
    verification-delta.schema.json
    trust-report.schema.json
    retention-review.schema.json
    operator-summary.schema.json
  jobs/
    <job-id>/
      job.json
      research-input.json
      idea-contract.json
      intent-review.json
      main-review.json
      product-plan.json
      build-plan.json
      verification.json
      qa-verification.json
      verification-delta.json
      trust-report.json
      retention-review.json
      operator-summary.json
      events.jsonl
  operator/
    latest-summary.json
  trust/
    latest-trust-report.json
  retention/
    latest-retention-report.json
```

### 6.2 D1 tables

Add indexed workflow state in D1 for UI and scheduling queries.

```sql
CREATE TABLE buildroom_jobs (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_band TEXT,
  trust_state TEXT,
  retention_recommendation TEXT,
  owner_role TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  workspace_path TEXT NOT NULL
);

CREATE INDEX idx_buildroom_jobs_agent_updated
  ON buildroom_jobs(agent_slug, updated_at DESC);

CREATE INDEX idx_buildroom_jobs_agent_stage
  ON buildroom_jobs(agent_slug, stage);

CREATE TABLE buildroom_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  actor_slug TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  artifact_name TEXT,
  message TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id)
);

CREATE INDEX idx_buildroom_events_job_created
  ON buildroom_events(job_id, created_at ASC);

CREATE TABLE buildroom_approvals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  decision TEXT NOT NULL,
  risk_band TEXT,
  auto_approved INTEGER NOT NULL DEFAULT 0,
  force_approved INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id)
);
```

D1 is the index and policy source. Workspace files are the durable receipts.

## 7. Job lifecycle

### 7.1 Stages

```text
created
research_collected
idea_proposed
intent_reviewed
approved_for_planning
blocked
product_planned
approved_for_coder
build_planned
implemented
coder_verified
qa_verified
verification_delta_recorded
trust_reported
retention_reviewed
closed
```

### 7.2 Status values

```text
active
blocked
needs_operator
failed
closed
```

### 7.3 Allowed transitions

| From                        | To                          | Required artifact                                   | Allowed role   |
| --------------------------- | --------------------------- | --------------------------------------------------- | -------------- |
| created                     | research_collected          | `research-input.json`                               | research, main |
| research_collected          | idea_proposed               | `idea-contract.json`                                | dreamer, main  |
| idea_proposed               | intent_reviewed             | `intent-review.json`                                | main, reviewer |
| intent_reviewed             | approved_for_planning       | `main-review.json` decision `approved_for_planning` | main           |
| intent_reviewed             | blocked                     | `main-review.json` decision `blocked`               | main           |
| approved_for_planning       | product_planned             | `product-plan.json`                                 | main           |
| product_planned             | approved_for_coder          | approval ledger decision `approved_for_coder`       | main           |
| approved_for_coder          | build_planned               | `build-plan.json`                                   | coder          |
| build_planned               | implemented                 | changed files receipt                               | coder          |
| implemented                 | coder_verified              | `verification.json`                                 | coder          |
| coder_verified              | qa_verified                 | `qa-verification.json`                              | qa             |
| qa_verified                 | verification_delta_recorded | `verification-delta.json`                           | qa, system     |
| verification_delta_recorded | trust_reported              | `trust-report.json`                                 | trust          |
| trust_reported              | retention_reviewed          | `retention-review.json`                             | retention      |
| retention_reviewed          | closed                      | `operator-summary.json`                             | main, operator |

## 8. Role and permission model

### 8.1 Role assignment

Add a per-agent buildroom role setting. Initially this can be stored in D1 as part of agent metadata or in a new table:

```text
research
dreamer
main
reviewer
coder
qa
trust
retention
operator
```

A single agent may hold multiple roles for small/demo setups, but production mode should warn when role separation is weak.

### 8.2 Hard policy rules

1. Dreamer cannot approve or write `main-review.json`.
2. Dreamer cannot transition jobs to `approved_for_coder`.
3. Coder cannot start without `approved_for_coder`.
4. Coder cannot modify files outside `product-plan.allowed_paths`.
5. Coder cannot silently add scope not present in `product-plan`.
6. QA must be separate from the Coder actor for the same job unless demo mode is enabled.
7. QA cannot mark a job confirmed without reading Coder verification and changed files.
8. Retention can recommend `prune`, but cannot delete live state.
9. Any destructive MCP/local-hands action requires the existing explicit confirmation gate.
10. Operator can force transitions only with `force_approved: true` and a reason.

### 8.3 Demo mode

For a single-user small setup, demo mode may allow one Downy agent to perform multiple roles, but all receipts and warnings must still be produced.

## 9. Artifact schemas

Schemas should live in code for validation and be mirrored into `workspace/buildroom/schemas/` for transparency.

Use Zod as the source of truth in `src/worker/buildroom/schemas.ts`, with optional JSON Schema export later.

### 9.1 Common fields

Every artifact should include:

```json
{
  "schema_version": 1,
  "job_id": "20260525-example-job",
  "agent_slug": "main",
  "created_at": "2026-05-25T12:00:00Z",
  "created_by": "main",
  "artifact_type": "product-plan"
}
```

### 9.2 `research-input.json`

Purpose: evidence packet from research lane.

Required fields:

- `summary`
- `sources[]` with URL/title/source type/timestamp/confidence
- `claims[]` with evidence references
- `watch_items[]`
- `open_questions[]`
- `research_limits`

### 9.3 `idea-contract.json`

Purpose: candidate idea handoff from Dreamer to Main.

Required fields:

- `title`
- `problem`
- `beneficiary`
- `why_now`
- `supporting_evidence[]`
- `out_of_scope[]`
- `proposed_location`
- `verification_idea`
- `risk_notes`
- `source_research_artifacts[]`

### 9.4 `intent-review.json`

Purpose: early filter.

Required fields:

- `decision`: `ready_for_main_review | needs_more_research | reject`
- `reason`
- `missing_evidence[]`
- `safety_notes[]`

### 9.5 `main-review.json`

Purpose: approval gate.

Required fields:

- `decision`: `approved_for_planning | approved_for_coder | blocked | needs_revision`
- `risk_band`: `low | medium | high`
- `risk_score`: integer 1-10
- `approved_by`
- `auto_approved`
- `force_approved`
- `block_reason`
- `approval_scope`

### 9.6 `product-plan.json`

Purpose: bounded plan Main gives to Coder.

Required fields:

- `objective`
- `allowed_paths[]`
- `planned_files[]`
- `non_goals[]`
- `acceptance_checks[]`
- `verification_commands[]`
- `risk_assessment`
- `protected_surface_notes[]`
- `rollback_notes`

### 9.7 `build-plan.json`

Purpose: executable plan by Coder.

Required fields:

- `implementation_steps[]`
- `files_to_change[]`
- `commands_to_run[]`
- `expected_outputs[]`
- `scope_check`

### 9.8 `verification.json`

Purpose: Coder receipt.

Required fields:

- `changed_files[]`
- `commands_run[]` with command/exit code/output excerpt
- `tests_passed`
- `known_gaps[]`
- `diff_summary`
- `commit_sha` optional

### 9.9 `qa-verification.json`

Purpose: independent QA receipt.

Required fields:

- `reviewed_files[]`
- `commands_run[]`
- `claims_checked[]`
- `tests_passed`
- `findings[]`
- `qa_decision`: `pass | fail | needs_changes`

### 9.10 `verification-delta.json`

Purpose: compare Coder and QA evidence.

Required fields:

- `state`: `confirmed | drift | regression | missing_evidence`
- `matching_claims[]`
- `mismatched_claims[]`
- `missing_evidence[]`
- `recommended_action`

### 9.11 `trust-report.json`

Purpose: room health summary.

Required fields:

- `trust_state`: `clean | watch | investigate`
- `reasons[]`
- `jobs_reviewed[]`
- `risks[]`
- `operator_attention[]`

### 9.12 `retention-review.json`

Purpose: recommendation on whether artifacts survive.

Required fields:

- `recommendation`: `keep | improve | park | prune`
- `reason`
- `artifacts[]`
- `follow_up_actions[]`
- `delete_allowed`: must be false for autonomous runs

### 9.13 `operator-summary.json`

Purpose: human-facing status packet.

Required fields:

- `headline`
- `active_jobs[]`
- `blocked_jobs[]`
- `recently_completed[]`
- `trust_state`
- `needs_attention[]`
- `next_actions[]`

## 10. Worker modules

Add a new worker module tree:

```text
src/worker/buildroom/
  artifacts.ts
  db.ts
  events.ts
  lifecycle.ts
  paths.ts
  permissions.ts
  schemas.ts
  tools.ts
  operator-summary.ts
  verification-delta.ts
  seeded-schemas.ts
```

### 10.1 `schemas.ts`

Exports Zod schemas and TypeScript types for all artifacts.

### 10.2 `paths.ts`

Centralizes safe path creation:

- buildroom root path,
- job directory path,
- artifact path,
- schema mirror path.

Must prevent path traversal and direct writes outside `workspace/buildroom/`.

### 10.3 `db.ts`

CRUD for:

- jobs,
- events,
- approvals.

### 10.4 `permissions.ts`

Determines whether an actor can write an artifact or transition a job.

Inputs:

- actor slug,
- actor role(s),
- target job,
- artifact type,
- requested transition,
- demo mode flag.

### 10.5 `lifecycle.ts`

Defines stages and allowed transitions. All state changes must pass through this module.

### 10.6 `artifacts.ts`

Validates artifacts, writes them to workspace, updates D1 indexes, appends events.

### 10.7 `verification-delta.ts`

Compares `verification.json` and `qa-verification.json` into a deterministic initial delta. Agents may enrich the reasoning, but the base state should be computed.

### 10.8 `operator-summary.ts`

Builds summary from D1 state and latest artifacts.

### 10.9 `tools.ts`

Registers buildroom tools for agents.

## 11. Agent tools

Add tools to `DownyAgent#getTools()` through a new buildroom tool builder.

Initial tools:

```text
create_buildroom_job
list_buildroom_jobs
read_buildroom_job
write_research_input
write_idea_contract
write_intent_review
write_main_review
write_product_plan
write_build_plan
record_verification
record_qa_verification
compare_verification_delta
write_trust_report
write_retention_review
build_operator_summary
```

### 11.1 Tool behavior

Each write tool must:

1. validate input with schema,
2. check role permission,
3. check lifecycle transition,
4. write artifact file,
5. update D1 job stage/status,
6. append D1 event,
7. append workspace `events.jsonl`,
8. return next required action.

### 11.2 Tool result shape

```ts
type BuildroomToolResult = {
  ok: boolean;
  jobId: string;
  stage: BuildroomStage;
  artifactPath?: string;
  nextActions: string[];
  warnings: string[];
};
```

## 12. UI/API

### 12.1 API routes

Add routes:

```text
GET /api/buildroom/jobs
POST /api/buildroom/jobs
GET /api/buildroom/jobs/:id
GET /api/buildroom/jobs/:id/events
GET /api/buildroom/jobs/:id/artifacts/:artifact
GET /api/buildroom/operator-summary
GET /api/buildroom/trust-report
GET /api/buildroom/retention-report
```

All routes should resolve the active agent slug the same way existing agent-scoped APIs do.

### 12.2 React routes

Add:

```text
/agent/:slug/buildroom
/agent/:slug/buildroom/:jobId
```

### 12.3 Sidebar section

Add a Buildroom section to `AgentPanel`:

- count active jobs,
- count blocked/attention jobs,
- latest trust state,
- next due scheduled workflow run.

### 12.4 Control Room page

The page should show:

- job table with stage/status/risk/trust/retention,
- kanban or lifecycle timeline,
- missing receipt checklist,
- latest operator summary,
- trust state card,
- retention recommendations,
- event log.

## 13. Scheduling integration

Scheduled tasks should be able to target workflow lanes.

Examples:

```text
Research daily:
  run research agent, write research-input.json

Dreamer daily:
  scan research packets and recent failures, write idea-contract.json

Trust daily:
  write trust-report.json for active jobs

Retention weekly:
  write retention-review.json for completed jobs
```

Do not schedule Coder by default. Coder runs only after Main approval.

## 14. Local hands architecture

Downy should support local tools through a secure bridge after the buildroom guardrails exist.

### 14.1 Metaphor

```text
Downy on Cloudflare = brain/coordinator
Local hands = Xurl, Jcode, browser profile, local repos, local CLIs
Tunnel/MCP bridge = nervous system
```

### 14.2 Candidate hands

- `xurl.search`
- `xurl.thread`
- `xurl.user_recent`
- `jcode.run_build_plan`
- `repo.status`
- `repo.diff`
- `browser.open`

### 14.3 Required guardrails

- signed requests,
- allowlisted tools,
- per-tool scopes,
- per-repo/path scopes,
- audit logs,
- timeout/concurrency limits,
- local kill switch,
- no arbitrary shell by default,
- explicit confirmation for destructive actions.

### 14.4 Jcode as Coder lane

Jcode should receive only approved `product-plan.json` and should return:

- `build-plan.json`,
- changed files / diff summary,
- verification command receipts,
- commit SHA if committed,
- `verification.json`.

Downy remains the orchestrator and approval authority.

## 15. Safety model

### 15.1 Protected surfaces

Protected surfaces include:

- auth,
- database migrations,
- deployment config,
- billing/payment,
- destructive Cloudflare operations,
- local files outside approved repo/path,
- secrets and credentials.

Plans touching protected surfaces require Main approval with `risk_band` at least medium and operator-visible warning.

### 15.2 Destructive actions

Reuse existing explicit confirmation gate pattern. Buildroom tools should never hide destructive side effects inside generic tool names.

### 15.3 Scope enforcement

Before a Coder or Jcode hand applies changes, Downy must check:

- every planned file matches `product-plan.allowed_paths`,
- no path traversal,
- no protected path unless explicitly approved,
- build plan does not include non-goals.

### 15.4 Human-in-the-loop gates

Initial production default:

- Main approval may be agent-authored but visible.
- Coder execution requires explicit approval unless job risk is low and auto-build is enabled.
- Deploy requires explicit operator confirmation.
- Prune/delete requires explicit operator confirmation.

## 16. Validation and tests

### 16.1 Unit tests

Add tests for:

- schema validation,
- lifecycle transitions,
- permission gates,
- path safety,
- verification delta computation,
- operator summary generation.

### 16.2 Fixture tests

Add demo buildroom fixtures:

```text
test-fixtures/buildroom/demo-room/
  research-input.json
  idea-contract.json
  intent-review.json
  main-review.json
  product-plan.json
  build-plan.json
  verification.json
  qa-verification.json
  verification-delta.json
  trust-report.json
  retention-review.json
  operator-summary.json
```

Validation command should ensure every fixture passes schemas and lifecycle ordering.

### 16.3 End-to-end demo

Create one demo job without external tools:

1. create research packet,
2. create idea contract,
3. approve with Main,
4. write product plan,
5. write build plan,
6. fake a small implementation artifact,
7. record coder verification,
8. record QA verification,
9. compute delta,
10. write trust and retention reports,
11. render operator summary.

## 17. Implementation phases

### Phase 1: Contract foundation

Deliverables:

- `src/worker/buildroom/schemas.ts`
- path helpers,
- lifecycle definitions,
- D1 migration for jobs/events/approvals,
- seeded schema mirror into workspace,
- fixture validation tests.

Acceptance checks:

- all schemas compile,
- invalid fixture fails,
- valid demo fixture passes,
- no UI required yet.

### Phase 2: Artifact tools and lifecycle enforcement

Deliverables:

- write/read artifact services,
- buildroom agent tools,
- permission checks,
- event log writes,
- job list/read API.

Acceptance checks:

- Dreamer cannot approve,
- Coder cannot write build plan before approval,
- invalid transition rejected,
- artifact write updates D1 and workspace.

### Phase 3: Operator UI

Deliverables:

- Buildroom sidebar section,
- `/agent/:slug/buildroom`,
- `/agent/:slug/buildroom/:jobId`,
- operator summary API,
- trust/retention display.

Acceptance checks:

- demo job appears with correct stage,
- missing artifacts shown,
- trust and retention cards render.

### Phase 4: Scheduled workflow lanes

Deliverables:

- schedule templates for Research, Dreamer, Trust, Retention,
- job creation from scheduled runs,
- background task output mapped into artifacts.

Acceptance checks:

- scheduled research can produce research packet,
- Dreamer can propose idea from research packet,
- no Coder execution without approval.

### Phase 5: Local hands bridge

Deliverables:

- local hands protocol spec,
- signed request verification,
- local hands MCP/HTTP connector,
- Xurl research hand,
- Jcode coder hand.

Acceptance checks:

- Xurl hand returns structured evidence for research packet,
- Jcode hand accepts approved product plan and returns verification receipt,
- disallowed path or command is rejected.

### Phase 6: Trust hardening

Deliverables:

- automated verification delta,
- trust rollups,
- retention recommendations,
- operator attention alerts,
- export sanitized buildroom bundle.

Acceptance checks:

- missing QA produces `missing_evidence`,
- coder/QA disagreement produces `drift`,
- trust state moves to `watch` or `investigate`,
- sanitized export excludes secrets/private state.

## 18. Open questions

1. Should role assignments be per agent globally, per workspace, or per job?
2. Should buildroom artifacts live only in workspace files, or should full JSON also be stored in D1?
3. Should approval be possible through chat tools only, or also through UI buttons?
4. How strict should demo mode be for single-agent local use?
5. Should Jcode commits happen automatically, or should Downy receive a patch first?
6. Should Downy create branches/PRs, or should Jcode own Git operations?
7. How should Xurl authentication/session health be surfaced in the operator UI?

## 19. Recommended next step

Start with Phase 1 and Phase 2 together as the minimum useful slice:

- schemas,
- D1 job/event/approval indexes,
- lifecycle enforcement,
- artifact write tools,
- one demo job fixture,
- basic job list/read API.

Do not build local hands first. The local hands become safe only after Downy can enforce approved plans, allowed paths, receipts, and QA deltas.

## 20. Success criteria

Downy is "up to spec" for the gkisokay workflow when:

1. every meaningful autonomous job has typed receipts,
2. Dreamer cannot approve its own ideas,
3. Coder cannot run without Main approval,
4. Coder scope is bounded by `product-plan.json`,
5. QA verification is independent,
6. verification delta is explicit,
7. trust and retention are visible to the operator,
8. scheduled autonomy can run Research/Dreamer/Trust/Retention safely,
9. local Xurl and Jcode hands can be attached without weakening the workflow gates,
10. an operator can inspect the Control Room and understand what happened, what is missing, and what needs attention.
