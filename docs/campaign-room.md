# Campaign Room

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

Phase 1 does **not** add GTM-specific artifact schemas yet. Template stages describe expected campaign artifacts in `completionCriteria`, but `requiredArtifact` is `null` so the existing Buildroom artifact validator is not forced to accept GTM schemas prematurely.

Phase 2 should add typed Campaign Room artifacts such as:

- campaign brief
- source notes
- content draft
- editorial review
- publish package
- ICP
- lead list
- enrichment notes
- qualification report
- personalization notes
- email sequence
- risk review
- send package
- digest

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
