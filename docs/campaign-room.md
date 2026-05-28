# Campaign Room

For operator setup and day-to-day usage, start with [`docs/campaign-room-user-manual.md`](./campaign-room-user-manual.md).

Campaign Room is the GTM workflow pack layered on top of the Buildroom workflow engine. It keeps the Buildroom investment useful while avoiding the heavy engineering workflow for content, lead sourcing, and outbound drafting.

## Phase 1 templates

Phase 1 seeds four default workflow templates:

- `campaign-content-v1`
  - source intake -> angle selection -> draft -> editorial review -> publish package
- `campaign-lead-sourcing-v1`
  - ICP definition -> account sourcing -> enrichment -> qualification -> operator review
- `campaign-cold-email-v1`
  - lead context -> personalization -> sequence draft -> spam/tone review -> operator approval
- `campaign-digest-v1`
  - source scan -> insight extraction -> opportunity ranking -> recommended actions

These are intentionally lightweight. They reuse existing `buildroom_workflow_templates`, `buildroom_workflow_runs`, stage runs, and gate decisions.

## Artifact strategy

Phase 2 adds typed Campaign Room artifacts stored under the existing Buildroom job workspace path, without polluting the engineering Buildroom artifact lifecycle.

Campaign artifacts are written with `write_campaign_artifact` and read with `read_campaign_artifact`. They live under:

```text
workspace/buildroom/jobs/<job-id>/campaign/<artifact-type>.json
```

Supported typed artifacts:

- `campaign-brief`
- `campaign-source-notes`
- `campaign-content-draft`
- `campaign-editorial-review`
- `campaign-publish-package`
- `campaign-icp`
- `campaign-lead-list`
- `campaign-enrichment-notes`
- `campaign-qualification-report`
- `campaign-lead-context`
- `campaign-personalization-notes`
- `campaign-email-sequence`
- `campaign-risk-review`
- `campaign-send-package`
- `campaign-digest`

These artifacts validate GTM outputs while workflow stage advancement remains controlled by the generic workflow tools. This keeps Campaign Room lightweight and avoids forcing content/lead/email artifacts into the high-assurance Buildroom engineering lifecycle.

## Scheduled Campaign tasks

Phase 3 adds Campaign Room schedule presets on top of Downy's existing scheduled task system.

Agent tools:

- `list_campaign_schedule_presets`
- `schedule_campaign_room_preset`

Seeded presets:

- `weekly-content-angles`
  - default: weekly Monday 14:00 UTC
  - scans sources and prepares content angles/briefs
- `daily-lead-sourcing`
  - default: daily 15:00 UTC
  - sources and enriches small batches of candidate accounts/leads
- `weekly-campaign-digest`
  - default: weekly Friday 16:00 UTC
  - summarizes GTM signals, opportunities, and next actions
- `daily-draft-review`
  - default: daily 17:00 UTC
  - reviews open drafts, lead batches, and send/publish packages

These presets create ordinary records in `scheduled_tasks`. They do not post content, send email, modify CRM data, or contact leads. Those actions remain behind operator confirmation gates.

## Safety model

Campaign Room drafts and packages GTM work. It should not post content, send email, modify CRM records, or contact leads without an operator confirmation gate.

## Why this preserves Buildroom work

Campaign Room is not a second system. It reuses:

- workflow template seeding
- workflow starts and stage advancement
- gates
- scheduled tasks
- local hands
- future artifact storage and operator UI

Buildroom remains the high-assurance engineering workflow. Campaign Room is the fast GTM workflow lane.
