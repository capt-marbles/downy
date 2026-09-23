---
name: gameye-outreach
description: Gameye outreach drafting and follow-up in Andrew's voice. Read a Lead from Airtable → two email variants (A blunt, B contrarian) plus DM copy → Gmail draft when a verified email exists → propose the CRM update and a Slack alert as cards. Draft only; never sends. Use when asked to draft outreach, write a cold email, or follow up on a lead.
---

Gameye sells dedicated game-server hosting and orchestration. This runbook turns a qualified Lead into outreach the operator reviews and sends by hand. Everything here is draft-only: Gmail drafts land in the operator's Drafts folder, CRM changes and Slack alerts are cards the operator confirms, and nothing is ever sent by Downy. Works from chat and from a voice call.

Two modes. **Outreach** for a lead that has not been contacted. **Follow-up** for a lead the operator already emailed. Decide from the Lead's Status and from Gmail, never from memory.

Scope: ONE lead per request. If the operator names no lead ("pick an old one"), choose one, the oldest Qualified lead with no drafts, say which one you chose, and draft only that one. Draft a batch only when the operator explicitly asks for several, at most five, and even then finish each lead (draft, cards) before starting the next. Search Gmail Drafts and Sent only for the chosen lead's address; never sweep addresses across leads. A voice lookup has a small step budget, so one lead at a time is also what fits.

## 1. Read the lead, exactly

Base `appZgInlaiE12FCu7`, Leads table `tblqqYLjWgLj87m25`, Contacts table `tblXVK9F4tZfvy4jj`. Find the Lead with `airtable_records` `list_records` and one formula on a distinctive token, lowercase: `FIND("distinctive studio name", LOWER({Lead Name}))` or on `{Domain}`. Read these fields: Lead Name, Company, Domain, Tier, Fit Score, Status, Contact Email, Outreach Angles, Notes, Contacts. If the Lead links a Contact, read it too: Contact Name, Email, Job Title, LinkedIn Profile, X/Twitter, Contact Stage, Outreach Drafts. Keep the `rec…` ids; every write below needs them.

Opt-outs are permanent: when a lead or contact asks not to be contacted, replies with an unsubscribe, or an email bounces, call `outreach_safety` `suppress` with the address (or `@domain` for the whole company) and the reason before anything else. Every Gmail draft is checked in code against that list and the recipient's Gmail history; a `blocked` result is final for this request, so report its reason.

Stop and say so when: the lead is not found (offer the closest names from the search); Status or Contact Stage is already `Draft Ready`, `Draft Ready (manual DM)`, `Contacted`, `Replied`, `Meeting`, `Won` or `Lost` and the operator did not ask for a follow-up; or the Lead is marked as an exclusion (platform-owned studio, vendor, crypto or web3). Never re-draft a lead that already has drafts; point at the existing draft set instead.

If the Notes lack a concrete signal, `web_scrape` the source URL in the Notes once. One or two lookups only; this is a drafting task, not research.

## 2. Draft in Andrew's voice

Draft BOTH email variants, plus DM copy for each channel that exists on the record:

- **Email A, blunt.** Open on the factual buying signal from the Notes, straight to value, short ask. 55 to 75 words.
- **Email B, contrarian.** Reframe the prospect's likely default ("the instinct is X; there's a middle path"), then Gameye value, short ask. 55 to 75 words.
- **LinkedIn DM**, about 50 words, only if a LinkedIn profile exists.
- **X DM**, 30 to 50 words, lowercase casual, only if an X handle exists.

Subjects are lowercase questions or fragments, no sequencer feel. Vary openers across a batch.

Voice rules, all hard: open with a specific factual observation about the studio's server or tech situation; no flattery, never "looks great", "sharp" or "a riot"; no em dashes; never the word "ace"; contractions; short sentences that lead with the point; sign as Andrew. Register: lowercase casual for Tier B and small studios, slightly more formal for Tier A. Tier B hook: "$50/mo a region, flat, real support." Tier A: multi-region orchestration, scale to demand instead of paying for peak, half-second starts, consistent 5GHz+ hardware for tick integrity, no egress fees. Positioning rule: never the "single-provider risk" or "vendor lock-in" angle, Gameye is itself one vendor; the multi-provider network may be cited only as reliability, uptime or coverage.

Worked example, Tier B: signal "online co-op up to four, playtest sign-ups open, demo this summer". A, subject `roads & riches co-op servers`: "Roads & Riches is online co-op up to four and you've got playtest sign-ups open with a summer demo. That's the window where server cost and reliability usually surprise a small team. We host dedicated servers for indies: push your container, call the API, sessions start in about half a second. Gameye Core is $50/mo a region, flat, with real support. Want the docs before the demo? Andrew". B, subject `skip the p2p tax on roads & riches`: "Plenty of co-op indies default to peer-to-peer to dodge server bills, then eat the host-migration bugs and the support tickets. For four-player co-op with a persistent economy, dedicated servers are simpler and cheaper than they look. Push a container, we run them, $50/mo a region flat. If the playtest stays quiet you pay almost nothing. Glad to talk it through. Andrew".

## 3. Deliver, branching on the contact path

**Email found** (Contact Email on the Lead, or Email on the linked Contact, marked verified in Notes or entered by the operator): first search Gmail with `gmail_email` `search` `in:drafts to:<email>` and `in:sent to:<email>`; an existing draft or sent message means stop and report it. Then run `check_outreach_draft` with the lead name, tier, the evidence the opener rests on (Notes, Outreach Angles, the source excerpt) and both variants. It checks the voice rules and whether the opening claim is in the evidence. On `block`, fix the named rules and check again, at most twice; never work around it. On `pass` or `revise` (revise once if a warning is easy to fix), call `gmail_email` `create_draft` to that address, subject = variant A's subject, and `body` = exactly the `body` the check returned. A template draft with any other body is refused. The body holds both variants:

```
===== VARIANT A (blunt), subject: <A subject> =====
<A body>

===== VARIANT B (contrarian), subject: <B subject> =====
<B body>

(keep one, delete the other and these markers, then send)
```

The draft is saved, not sent; say exactly that. If the draft call fails or times out, do not retry; search Drafts before trying again.

**No email, LinkedIn or X found:** no Gmail draft. The Slack alert (step 4) carries the profile URL and the ready-to-send DM text; the operator sends it by hand.

**No email and no profile:** the alert names whatever path exists (Discord, Steam page, studio site or contact form) with the drafted message, flagged "no direct email or DM channel found".

## 4. Record it and alert, as cards

Propose the CRM update with `stage_action` kind `airtable_update_records`, `typecast: true`, one `recordLabel` per record. Only the fields below change.

- If a linked Contact exists, update the Contact `rec…`: Outreach Drafts `fld0LF1jhcZlUuwTT` = the full draft set (A, B, LinkedIn, X, each labelled), Contact Stage `fldXsrMfFJow78AsN` = `"Draft Ready"` or `"Draft Ready (manual DM)"`, Activity Timeline `fldxlm1LgjgF5CRiC` = existing text plus one dated line `YYYY-MM-DD drafted outreach (A/B) → Gmail Drafts` or `→ DM via <channel>`.
- Otherwise update the Lead `rec…`: Status `flds3DTpqS7AZ878k` = `"Draft Ready"` or `"Draft Ready (manual DM)"`, Notes `fldYHGSfNW9rZG3bs` = existing Notes plus a dated `Outreach drafts` block with the full draft set and the delivery path.

Then propose the alert with `stage_action` kind `slack_post_message` to the operator's lead channel: find `#agent-leads` with `slack_channels` and use its id; `channelLabel: "#agent-leads"`. Start the text with `<@UJB0175DM>`. Slack mrkdwn, single asterisks for bold.

Email found:

```
<@UJB0175DM> :email: *Draft ready: <Studio>*  (<Tier> · fit <score>)
*Contact:* <Name>, <Title>  <email>
*Signal:* <one line + source>
Email draft (A/B) is in your Gmail Drafts. *CRM:* https://airtable.com/appZgInlaiE12FCu7/tblqqYLjWgLj87m25/<recId>
```

No email:

```
<@UJB0175DM> :speech_balloon: *DM to send: <Studio>*  (<Tier> · fit <score>)
*Signal:* <one line + source>
*LinkedIn:* <url>   *X:* <@handle / url>
*DM to send:*
<LinkedIn or X DM text>
*CRM:* https://airtable.com/appZgInlaiE12FCu7/tblqqYLjWgLj87m25/<recId>
```

Say both cards are waiting in chat. Use `list_staged_actions` to learn their outcomes; an `unknown` outcome means check the record or channel before proposing again. If Slack is not connected, say so once and skip the alert; the chat summary is the record.

## 5. Follow-up mode

When asked to follow up on a lead: read it as in step 1, then `gmail_email` `search` `to:<email> in:sent` to confirm a first email went out and when. No sent message means there is nothing to follow up; say so and offer step 2 instead. With a sent message, `read` it for the thread id, then draft ONE follow-up of 40 to 60 words: reference the specific point of the first email, add one new fact or angle from the Notes, one short ask, sign as Andrew. Create the Gmail draft as a reply in that thread (`threadId`). Propose the CRM update: Status or Contact Stage = `"Contacted"` and a dated timeline or Notes line `follow-up drafted`. No Slack alert for a follow-up unless asked. Never draft a third touch without the operator saying the second was sent and had no reply.

## 6. Summary and voice

Report: the lead, tier and signal; which contact path was used; that the Gmail draft is saved and not sent, or that no draft was possible and why; the two cards awaiting a tap. In a voice call, say the draft is saved for review and the cards are in chat; never read the email bodies aloud unless asked, and never say anything was sent.
