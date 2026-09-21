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

## Tool-call effect gate

Name allowlists decide which tools a read-only worker or a voice turn may
call. They cannot see that the same tool reads or acts depending on its
arguments: `web_scrape` of a product page is a read; `web_scrape` of an
unsubscribe link with a token changes state on someone else's server. Before a
gated tool executes, one Jev request classifies the exact call (tool name,
truncated description, redacted arguments) into `read_only`, `metered_read`,
`workspace_write`, `proposal_only`, `external_effect` or `destructive`, plus a
`noul` for whether the effect is hard to undo. `metered_read` is a paid data
lookup through a tool catalog such as Treg: it spends prepaid balance but
changes nothing, so it runs and is recorded. Using the same catalog to post,
send, publish or generate is `external_effect`. Code owns the consequence:

- `external_effect` and `destructive` are blocked. The tool result tells the
  model nothing ran and to use a different input or the chat controls.
- Below `EFFECT_GATE_CONFIDENCE_FLOOR` (default `0.6`) the riskier of the two
  most probable classes is assumed. Uncertainty between read and workspace
  write still runs; uncertainty that straddles the external line blocks.
- Evaluator errors, deadlines (3 s) and unoffered classes fail open and are
  recorded as `unavailable`. The allowlists remain the hard floor, so an
  outage degrades to the previous behaviour instead of widening it.
- Empty-argument calls and MCP calls carrying `confirm_destructive_action`
  skip the evaluator; an explicit operator confirmation is not second-guessed.

Where it applies: read-only background workers gate every allowlisted tool;
voice, chat and full-access workers gate the read-oriented tools (`web_search`, `web_scrape`, `read`, `list`, `find`,
`grep`, skill reads, `read_peer_agent`), every MCP proxy tool, and the
Composio-backed connected-service wrappers (`gmail_email`, `airtable_records`),
which reach the user's accounts exactly as an MCP proxy does. Tools whose
declared purpose is to act (`schedule_task`, `delete`, `stage_action`, MCP
tools named destructively) keep their existing confirmation paths and are not
gated. In voice that also covers `stage_action`, `create_bot`,
`spawn_background_task` and the new-file `write`: a card that the operator
must tap is proposal_only by construction, and a probability must not be able
to veto it. Jev never marks a call safe, never chooses an action and never
confirms a proposal.

Before the call leaves the worker, argument values under secret-looking keys,
bearer or basic values, token-shaped words and secret-named query parameters
are replaced with `[redacted]`; long strings and arrays are truncated. Set
`EFFECT_GATE_ENABLED=false` to disable. Every non-skipped decision is stored in
`tool_effect_decisions` with the model version, class, confidence, whether the
riskier reading applied, and the elapsed time, so blocks and outages are
inspectable per bot. See `src/worker/agent/effect-gate.ts` and
`scripts/jev-lab/` for the experiment that motivated the class set
(11 of 12 calls classified as intended; the miss was uncertain and would have
been blocked by the riskier-reading rule).
