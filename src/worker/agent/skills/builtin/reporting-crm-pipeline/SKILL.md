---
name: reporting-crm-pipeline
description: Produces complete, deterministic Airtable CRM stage counts for a written or spoken pipeline report. Use when asked for lead counts, pipeline stages, or a CRM rundown.
---

Use airtable_records directly; no local computer skill file is needed. If unavailable, explain that this bot needs Airtable authorization through the connection card.

1. List authorized bases, following offsets if needed. Match the requested CRM by name; ask if ambiguous.
2. Get its schema. Choose the requested leads table and exact stage field ID. If multiple plausible tables or stage fields exist, ask rather than choosing silently. Explain whether the request means all records or a subset; pipeline_report counts all records in the selected table.
3. Call airtable_records with action pipeline_report, baseId, tableId, and stageFieldId. The server validates the schema, requests only the stage field, follows pages and counts records in code.
4. If state is partial and resumable is true, repeat the same arguments with the returned reportId. Do not add partial counts together: each result is cumulative. Stop on failure or a non-resumable result; report that no complete total was established.
5. Only complete:true supports a full pipeline rundown. Give total records, counts for each stage (including zero-count schema choices), and missingStage. State the base, table, field, and observation time. A paginated live read is not a point-in-time snapshot; concurrent edits may affect it.

Keep a spoken rundown short. If the call budget ends, clearly label the result partial. Save a Markdown report only when requested, using the permitted workspace report writer and verified tool output. Do not enrich contacts, modify records, or initiate outreach as part of counting.
