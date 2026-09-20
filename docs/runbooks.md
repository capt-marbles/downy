# Downy task runbooks

Two bundled workspace skills are installed for each bot on its next turn:
`connecting-services` and `reporting-crm-pipeline`. Their full instructions load
through `read_skill`; only their short catalog entries live in every prompt.
Existing operator-authored files are preserved. The skills are guidance;
permissions and verification remain enforced in Worker code.

## Connect a service

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

Code validates the schema, fetches only the stage field at 100 records/page,
counts each record ID once, includes empty stages and zero-count select options,
and saves progress after each validated page. Each call processes up to five
pages, checking a 20-second budget between reads. Existing provider request
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
