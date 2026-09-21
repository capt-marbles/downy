---
name: gameye-lead-sourcing
description: Gameye daily lead sourcing from the open web. Exa discovery → typed Jev qualification → exact Airtable dedupe → propose new Leads records as a card → Treg contact enrichment → batch summary. Use when asked to run lead sourcing, find new studios, or refresh the lead batch.
---

Gameye sells dedicated game-server hosting and orchestration. The goal is to find studios building ONLINE MULTIPLAYER games approaching a playtest, beta, early access or launch, qualify them, dedupe against the CRM, and propose the new qualified leads for the operator to confirm. Nothing is written to Airtable, Slack or email without a confirmed card. Report every step with counts.

Batch ID for this bot is `downy-exa-YYYY-MM-DD` (today, UTC). Never reuse the Hyperagent prefix `exa-`.

## 1. Discover with web_search

One call, four queries, `numResults: 10`, `startPublishedDate` = seven days ago as `YYYY-MM-DD`:

- A, playtest and launch signals: `multiplayer game playtest OR "closed beta" OR "early access" OR "server slam" studio announcement`
- B, competitor pain and migration: `Hathora OR GameLift OR Edgegap OR "Unity Multiplay" OR GameFabric (migrate OR shutdown OR alternative OR expensive OR "moving off" OR "egress costs") game servers`
- C, studio dev-blog infrastructure: `game studio dedicated servers "server infrastructure" OR "backend infrastructure" OR "server scaling" multiplayer launch`
- D, indie multiplayer debut: `indie studio "multiplayer game" announcement playtest OR beta OR "early access"`

Use `category: "news"` on A and D. Merge hits across queries. Remove duplicates by URL, then by game or studio name. For each remaining hit record: studio, game, URL, title, publishedDate, and the excerpt or summary as the snippet. If the studio is not named in the hit, keep it only if web_scrape of the URL names it; otherwise drop it as unattributable.

## 2. Qualify with qualify_leads

Pass all candidates in one call (chunk at 40). Trust the typed verdicts; do not re-argue tiers in prose. Rules the tool applies: real-time online multiplayer near launch or with explicit server language is Tier A when funded or backed, otherwise Tier B; small online co-op is Tier B; turn-based, card, async, local, single-player, crypto or web3, platform-owned first-party studios, vendors, player complaints and aggregators are dropped. `needs_review` means the text did not settle the multiplayer type: list those separately for the operator and do not propose records for them.

## 3. Dedupe with airtable_records, exactly

Base `appZgInlaiE12FCu7`, Leads table `tblqqYLjWgLj87m25`. Never use fuzzy search. For each kept lead run `list_records` with `fields: ["Lead Name","Company","Domain"]` and one formula per key, normalised to lowercase without scheme or www:

- Domain: `FIND("studio.example", LOWER({Domain}))`
- Company and Lead Name: `FIND("distinctive studio name", LOWER({Company}))` and the same on `{Lead Name}`. Use a distinctive multi-word token; never a short ambiguous one.

Any hit means DUPE: skip it and name it in the summary. Create only when every check returns no records.

## 4. Propose the records with stage_action

Kind `airtable_create_records`, `baseId` and `tableId` as above, `tableLabel: "Leads"`, `typecast: true`, at most 10 records per card, one `recordLabel` per record in the form `Studio — Tier A — domain — game`. Field IDs as keys, plain option names for selects:

- Lead Name `fldfuqPygBrGEU9MZ`, Company `fldh11w7pgTihqOzp`, Domain `fldpI1FaU1y2sPaPq`
- Lead Source `fldbwik3RLhqOhIGN` = `"Web / Exa"`, Status `flds3DTpqS7AZ878k` = `"Qualified"`
- Tier `fldUT9pZN6gBORLJu` = `"A"` or `"B"`, Priority `fldSFuet2qydI2n3P`, ICP Fit `fldPy94RCUWv2N10o` (from the verdict)
- Multiplayer Focus `fldA3jrip8RlsXuTA` = `"Yes"`, Current Infra `fldvw732vuWfBhkNw` (verdict `currentInfra`)
- Fit Score `fldRC4AohOLLsoANk` (verdict number), Batch ID `fldQltc7zgo3S6wGh`, Enrichment Status `fldPfn8uHz5Ph5GfZ` = `"Pending"`
- Outreach Angles `fldSaxtcj7d2SlcbX` (one line: the server angle for this studio)
- Notes `fldYHGSfNW9rZG3bs`: game, the signal in one sentence, source URL, verdict reasons, and any named competitor

Say the card is waiting in chat. Nothing is created until the operator taps Confirm. Use list_staged_actions to learn the outcome; an `unknown` outcome means check the table for the Batch ID before proposing again.

## 5. Stage a contact through Treg, cheaply

Contact and company enrichment goes through the Treg tool catalog, connected to this bot as an MCP server at `https://treg.to/mcp/` (ask the operator to run connect*mcp_server if its tools, named `tool_treg*\*`, are absent). Treg spends a small prepaid balance per call and returns the provider's data; it never sends or posts on our behalf. Only call routed read endpoints (`treg.people.search`, `treg.people.email.find`, `treg.companies.enrich`) or `exa.people.search`. Never call an endpoint that posts, publishes, generates media or sends messages.

Per kept lead with a resolvable domain, in this order, and stop when a step misses:

1. `tool_treg_call` `treg.companies.enrich` with `{ "domain": "studio.example" }`: headcount and funding for the Notes. Skip if the verdict already had funding evidence.
2. `tool_treg_call` `treg.people.search` with `{ "company_domain": "studio.example", "title": "CTO OR technical director OR lead engineer OR founder", "limit": 3 }`. `limit` is the price dial; never raise it above 5. Pick the most technical senior person; else founder, producer or head of production.
3. `tool_treg_call` `treg.people.email.find` with `{ "first_name": "…", "last_name": "…", "domain": "studio.example" }` only for that one person. A miss is normal for small studios; do not try other names.

Record the recommended contact, title, LinkedIn URL if returned, and the `cost_usd` of each call in that lead's Notes on the card. Keep total spend under about five cents per lead and say the batch total in the summary. Never write an email into Contact Email unless the provider marked it verified; otherwise leave it in Notes. If Treg returns 402 the balance is out: report it and continue without enrichment; do not retry. If a call times out, do not repeat it: repeat only with the same `idempotency_key`, which replays free. Treg is not connected: say so once and set Enrichment Status to `"Pending"`.

## 6. Summary

Date and batch id; candidates per query; qualified, needs review, dropped; created versus skipped as dupes, naming the dupes; each proposed lead with tier, one-line server angle and recommended contact; the Leads table link https://airtable.com/appZgInlaiE12FCu7/tblqqYLjWgLj87m25. State the Treg spend for the batch. If any lead was left unenriched, end with: "Reply 'enrich today's batch' to run Treg enrichment on the N remaining leads (about $0.05 each)." On a zero-lead day say so plainly. If Slack is connected (slack_channels is available), also propose the same summary as a stage_action card of kind slack_post_message to the operator's lead channel (find its id with slack_channels; #agent-leads unless told otherwise), headed "✅ Gameye lead sourcing · batch downy-exa-YYYY-MM-DD". Post only after the Airtable card has been confirmed, so the digest reports what was actually created. If Slack is not connected, the summary in chat is the record.
