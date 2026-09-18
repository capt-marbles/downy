# Jev draft criteria

Campaign stages name their typed campaign artifact separately from engineering
artifact names. Advance reads that job's artifact and evaluates the existing
criteria in one `env.AI.run('typesafe/jev', ...)` request. The state is capped at
48,000 characters and truncation is recorded. No new agent tool or API key.

`JEV_GATING_ENABLED` defaults to `true`, `CRITERIA_PASS_THRESHOLD` to `0.7`, and
`CRITERIA_CONFIDENCE_FLOOR` to `0.6`. `JEV_DISABLED_TEMPLATES` is a JSON list of
opted-out template IDs. Settings displays these operator-owned values read-only.

Cloudflare's exact schema uses a named `questions` object. Boolean questions are
`noul` and return only `noul` (probability true), with **no confidence field**.
For Boolean policy confidence we explicitly derive `max(p, 1-p)`: certainty in
the more likely answer. This is not an independently calibrated confidence value.
The overall `score` question does have model confidence; it is informational,
and its score is stored normalized to 0..1 in the probability column.

Confident failed criteria block and return the original criterion text and
probability. Uncertainty warns and escalates through the existing gate; ungated
stages proceed. A passing evaluation never creates a gate decision. Operator
confirmation and agent-review gates still require their existing decisions.

The 8-second evaluation deadline and model errors fail open with a warning in
the tool result and stage-run notes. This is draft evaluation, not permission to
send, publish or modify CRM. Evaluations live in `workflow_criteria_evaluations`,
separate from gate decisions, with the returned model version on every answer.

Schema source: https://developers.cloudflare.com/ai/models/typesafe/jev/ and its
linked schema-input.json / schema-output.json, checked 2026-09-18.
