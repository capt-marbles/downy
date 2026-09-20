---
name: gameye-lead-sourcing
description: Gameye daily lead sourcing from the open web. Exa discovery → typed Jev qualification → exact Airtable dedupe → propose new Leads records as a card → contact staging → batch summary. Use when asked to run lead sourcing, find new studios, or refresh the lead batch.
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

## 5. Stage contacts without spending credits

If an Apollo MCP server is connected (a tool whose name contains `apollo` and `people` and `search`), run its free people search with the studio name to identify the best contact: CTO, backend or game programmer, technical designer; else founder, producer or head of production. Put the recommended name, title and Apollo id in that lead's Notes on the card. Never call a match, enrich or email-verify action: those cost credits and need explicit approval. Never write an unverified email into Contact Email. If Apollo is not connected, say so once and set Enrichment Status to `"Pending"` unchanged.

## 6. Summary

Date and batch id; candidates per query; qualified, needs review, dropped; created versus skipped as dupes, naming the dupes; each proposed lead with tier, one-line server angle and recommended contact; the Leads table link https://airtable.com/appZgInlaiE12FCu7/tblqqYLjWgLj87m25. End with: "Reply 'enrich today's batch' to run Apollo enrichment and email verification on the N staged contacts (about N credits)." On a zero-lead day say so plainly. Posting this digest to Slack is not available from Downy yet; the summary in chat is the record.
