# Downy task runbooks

Two bundled workspace skills are installed for each bot on its next turn:
`connecting-services` and `reporting-crm-pipeline`. Their full instructions load
through `read_skill`; only their short catalog entries live in every prompt.
Existing operator-authored files are preserved. The skills are guidance;
permissions and verification remain enforced in Worker code.

## Connect a service

Which services can be connected, and how, is code-owned in
`src/worker/runbooks/service-registry.ts` and rendered into every system prompt
as a `## Connections` section. Gmail and Airtable are Composio-managed cards.
Treg is an MCP server the runbook tells the model to attach with
`connect_mcp_server`. Slack is listed as planned and TaskFuel as not
connectable (CLI only, no MCP); for both, and for any service outside the
registry, `find_tool_setup` returns a `not_available` or honest
`candidate_found` step whose `nextAction` tells the model to say so plainly and
not to ask the user to choose between candidates it cannot act on.

`find_tool_setup` resumes a per-bot Durable Object checkpoint. It checks existing
managed authorization or attached MCP servers before discovery. Discovery uses
Composio, known documented MCP endpoints, then vendor-documentation search.
A failed lookup is reported as unavailable, not as proof of no integration.
Discovery is cached, with up to three requested attempts per 15-minute window.
An explicit `retry:true` can begin a new window after the cooldown.

Gmail and Airtable use existing secure OAuth cards. After authorization,
`find_tool_setup` or `list_mcp_servers` resumes pending verification. The latter
checks at most 20 saved runbooks. Identity plus a successful minimal read is
required for `verified`. Airtable checks accessible-base metadata; Gmail performs
a one-message search without returning message contents in setup results.
Verification does not test draft creation or assert access to a particular CRM
base/table. Those permissions are checked when used.

Generic MCP connections are marked `awaiting_read_verification` when attached.
Downy must select and execute an appropriate minimal read before claiming that
an intended task works; the generic checkpoint does not auto-certify an arbitrary
tool as safe. Unknown-service candidates retain confirmed/guess confidence.
Official setup documentation and intended operations are requested when needed.
Secrets remain in OAuth or secure credential entry, outside chat and checkpoints.

Chat shows a timestamped setup checkpoint separately from the live authorization
card. Airtable reads and pipeline reports work in chat and voice; Gmail's combined
read/draft tool remains chat-only. Background agents are not granted new access.

## Report CRM pipeline

`airtable_records` adds `pipeline_report` with `baseId`, `tableId`, and
`stageFieldId`. Select these from the live schema. It counts all records in that
table; it does not apply an implicit active-lead filter. Single-select and text
stage fields are supported. Ambiguous choices require clarification.

Code validates the selected stage field, fetches only that field at 100 records/page,
counts each record ID once, includes empty stages and zero-count select options,
and saves progress after each validated page. Each call processes up to five
pages, checking a 20-second budget between reads after schema validation. Unrelated fields and tables do not inherit the selected stage's aggregation limits. Existing provider request
timeouts still apply to an in-flight read.

Partial results return `reportId`, cumulative counts, `resumable`, and a bounded
reason. Repeat the same arguments with `reportId` to continue; do not add results
together. `totalRecords` is null until `complete:true`. Reports expire after
15 minutes and cap at 50,000 records/500 pages. Cursor loops, schema changes,
account changes, or malformed pages never become complete totals. Record IDs
and cursors stay in per-bot DO checkpoints, chunked below storage value limits;
they are not sent to the model. Concurrent report calls are serialized.

A complete report is a paginated live observation, not a transactional snapshot.
Concurrent Airtable edits can affect it. Report the observation time and that
limitation. No CRM writes, enrichment, or outreach are performed.

### Large Airtable schemas

Composio can offload a successful schema response to a remote JSON file even
when inline responses are requested. The adapter recognizes this case and uses
a fixed, server-owned read-only projection through Composio's workbench. It reads
only the returned file and retains table IDs/names, field IDs/names/types, and
select-choice names. Compression keeps that metadata below inline output limits.
The workbench is not exposed as an agent tool; model-supplied Python and external
app actions are not accepted. Unsafe paths, oversized files, incomplete output,
and malformed schemas fail without claiming verified access.

`POST /api/composio/oauth/airtable/check` with `{ "baseId": "app..." } checks the
schema through the same adapter. It requires Cloudflare Access, same-origin POST,
and the calling bot's existing Airtable grant. The result contains table/field
counts or fixed diagnostic codes and response-shape flags, never record contents,
credentials, provider error text, or remote file paths.

The same pipeline runbook is available for authenticated acceptance checks at
`POST /api/composio/oauth/airtable/pipeline-report`, with the `pipeline_report`
action body above. It requires the existing per-bot Airtable grant and the same
Access/origin checks. Resume with `reportId` until `complete:true`; no raw lead
records are returned. Failures expose a fixed phase and code, not provider text.

### Transient Airtable reads

Read-only Airtable actions retry once after a timeout or HTTP 502/503/504/network
failure, provided the first attempt took less than 45 seconds. The retry checks
the pinned account again. Permission, argument, unknown-provider and invalid
response failures are not automatically retried. This policy does not apply to
Gmail drafts or any write. Safe phase and error codes survive the Durable Object
RPC boundary; raw provider messages and credentials do not. A temporary read
failure does not establish a need to reconnect the account.

## Lead sourcing (Gameye)

The bundled `gameye-lead-sourcing` skill ports the Hyperagent Exa daily routine:
four `web_search` queries with a seven-day `startPublishedDate` window, typed
qualification with `qualify_leads`, exact-match dedupe with `airtable_records`
`list_records` formulas, and new Leads proposed as one `airtable_create_records`
card that the operator taps. Batch IDs use the `downy-exa-` prefix so runs never
collide with Hyperagent's `exa-` batches during the transition.

`qualify_leads` (`src/worker/runbooks/lead-qualify.ts`) asks Jev seven fixed
questions per candidate: multiplayer architecture (choice), launch proximity
(score), server pain, funding, studio-signal and exclusion (nouls), and named
hosting vendor (choice). Code composes tier, priority, ICP Fit and Fit Score
with the weights from the original `qualify.py`, so verdicts are reproducible
and the rubric changes in one file, not in a prompt. Below the 0.6 confidence
floor, or when the type is `unclear`, the lead is `needs_review` rather than
kept or dropped. Evaluator failures are returned per candidate as
`unavailable`; the tool writes nothing.

Contact and company enrichment goes through the Treg tool catalog, connected
per bot as an MCP server (`https://treg.to/mcp/`). The skill limits calls to
routed read endpoints (`treg.people.search`, `treg.people.email.find`,
`treg.companies.enrich`, `exa.people.search`) and about five cents per lead.
The effect gate classifies those calls `metered_read` and lets them run; a Treg
call that would post, publish or generate is `external_effect` and blocked.
Apollo is not used.

Not yet available from Downy: the Slack digest (no Slack connection type
exists; the chat summary is the record) and unattended scheduled runs
(background workers hold no Composio grants).
