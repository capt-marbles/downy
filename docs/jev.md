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
The Workers AI binding returns third-party answers inside
`{ state: "Completed", result: ... }`. The shared adapter unwraps and validates
that envelope before either policy consumes it; incomplete or failed responses
remain evaluator failures. Verified against a live binding after funding.

## MCP connection triage

Failed MCP connects invoke one Jev `choice` classification plus a `noul`
retry-worthwhile question. Only header names enter the request; known credential
values are scrubbed from probe text and error output. The deterministic ladder
allows at most four connect attempts in 20 seconds, with an independent five-second
classifier deadline. `MCP_TRIAGE_CONFIDENCE_FLOOR` defaults to `0.6`.

Rejected credentials stop immediately and create a secure credential ticket.
Transport and URL repairs follow a fixed order; outages and rate limiting receive
one short backoff retry. Low confidence, unknown classes or evaluator outages
return manual troubleshooting guidance only in the failure result. Jev never
marks an endpoint trustworthy, validates a credential, or approves a gate.
`mcp_connect_diagnostics` records the model version, class, confidence, HTTP status,
attempt ladder and outcome without credential values.
