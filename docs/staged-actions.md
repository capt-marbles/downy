# Staged actions: propose in chat or voice, confirm with a tap

A staged action is a proposal card in chat. The agent creates it with
`stage_action` from chat or from a voice call; nothing runs until the operator
taps **Confirm and run** on that card. No model tool can confirm a proposal,
and a spoken or typed "yes" never does. This is the executor path for external
GTM actions from voice, where the caller cannot tap mid-sentence but can review
the card afterwards on the same device.

## Kinds

- `gmail_draft`: recipient, subject, body and optional thread. Runs the
  existing Composio Gmail draft action for the bot's authorized account. The
  draft is never sent.
- `schedule_task`: title, kind, brief and cadence. Creates a recurring
  scheduled task through the existing scheduler store.
- `airtable_create_records`: base, table, up to ten records keyed by field ID
  or name, `typecast`, plus a `tableLabel` and one plain `recordLabel` per
  record so the card is readable without knowing field IDs. Runs
  `AIRTABLE_CREATE_RECORDS` once through the bot's Airtable grant; never
  retried. A timeout is recorded as `unknown` because the rows may exist. The
  chat tool `airtable_records` stays read-only; this card is the only write.
- `airtable_update_records`: base, table, up to ten `{ id, fields }` patches
  where `id` is a `rec…` id read from `airtable_records` and `fields` holds only
  what changes (`null` clears a field), plus a `tableLabel` and one
  `recordLabel` per record. Runs `AIRTABLE_UPDATE_MULTIPLE_RECORDS` once
  through the bot's Airtable grant; never retried, and a timeout is `unknown`
  because the patch may have applied. Unlisted fields are untouched. A
  standing grant of the same kind covers it for scheduled runs; a create
  grant does not.
- `outreach_unsuppress`: an address or `@domain` and the reason. Removes it
  from the do-not-contact list. Operator-only: no model tool can lift a
  suppression.
- `outreach_abandon`: an unresolved draft attempt's id, recipient and
  subject. Closes an attempt whose outcome is unknown so a new draft to that
  recipient is allowed, accepting that it may duplicate one that exists.
- `slack_post_message`: channel id or name, a `channelLabel` for the card, and
  the exact text. Runs `SLACKBOT_SEND_MESSAGE` once through the bot's Slack
  grant, posting as the Downy app; never retried, and a timeout is `unknown`.
  The chat tool `slack_channels` only lists channels.

Payloads are strict; unknown fields are rejected so a proposal cannot smuggle a
wider action than the card shows.

## Lifecycle

`proposed` → `executing` → `succeeded` | `failed` | `unknown`, or
`proposed` → `cancelled`. Proposals expire after 24 hours.

- The card quotes the proposal's `revision`; confirmation must send the same
  value. A changed proposal is a new card and a new decision.
- Confirmation runs in a storage transaction and fixes one `operationId`
  before the executor starts. A repeated tap or retried request observes the
  same single-flight run; it never issues a second operation.
- Fresh verification runs immediately before the connector call, through the
  same grant and never from the card's text: a Slack post requires the channel
  to still resolve and the app to still be a member; creating records requires
  the table to still be in the base schema; updating records requires every
  target `rec…` id to still exist in that table. A verification failure is
  recorded as `failed` with the reason, because nothing ran, and is distinct
  from `unknown`. Gmail's wrapper already re-checks the granted account before
  every action.
- A Gmail error after submission is recorded as `unknown`, because Composio
  does not distinguish a rejected request from a lost acknowledgement. The
  card and receipt tell the operator to check Drafts before proposing again.
  Nothing retries automatically.
- If a restart interrupts an executing proposal, the next read marks it
  `unknown` after two minutes instead of retrying.
- Every settled state appends one deterministic receipt message to chat, so
  the agent and a later voice call see the real outcome. `list_staged_actions`
  reads the same records.

## Endpoints

- `GET /api/staged-actions?id=<uuid>` restores a proposal.
- `POST /api/staged-actions?id=<uuid>&confirm=1` with `{ "revision": "<uuid>" }`
  confirms and runs it.
- `POST /api/staged-actions?id=<uuid>&cancel=1` cancels it.

Writes require same origin. Existing Access and active-agent checks apply.
Responses are private and uncached. A proposal must still belong to the
conversation.

## Voice

`stage_action` and `list_staged_actions` are in the voice allowlist. Gmail
drafts from voice are created directly through `gmail_email`, because a draft
is never sent; the `gmail_draft` kind remains for chat when the user wants to
review before the draft exists. The voice turn is told to say a proposal is in
chat awaiting a tap, and the spoken
outcome is derived from the tool receipt, not from the model's prose: "drafted"
or "scheduled" in the reply is replaced by "Nothing has run". The live
instructions repeat that a spoken yes does not confirm.

## Not yet covered

- Editing a proposal on the card. Ask the agent for a revised proposal; it
  creates a new card and the old one can be cancelled.
- Sending email, CRM writes, publishing. The kinds above are the only
  executors; adding one means adding an executor with the same
  confirmed/failed/unknown contract, not widening a payload.

## Standing approvals for scheduled runs

A `schedule_task` proposal may carry `grants`: `airtable_create_records` for one
base and table, or `slack_post_message` for one channel (at most five). The card
lists them under "Standing approval for every run", so the operator's tap
approves the schedule and those actions together. The plain `schedule_task`
tool never accepts grants; only a confirmed card can create them.

A scheduled worker whose task carries grants gets `stage_action`,
`list_staged_actions`, and read tools for the approved services
(`airtable_records` reads, `slack_channels`). Its proposals are created with
`source: "scheduled"`. When a grant covers the proposal, exactly the same base
and table or the same channel, the parent confirms it at once with
`confirmedBy: { scheduleId, scheduleTitle }`, runs it through the ordinary
single-flight executor, and posts a receipt that begins "Run under your
standing approval for …". A proposal no grant covers stays a card for the
operator. Grants are stored on the schedule (`grants_json`) and copied onto
each run's background-task record; a worker never widens its own approvals.

## Outreach safety

Adapted from Village's send rules for a draft-only agent. Every Gmail draft,
whether from `gmail_email`, a `gmail_draft` card, voice or a schedule, runs
through `guardedCreateDraft` in the Gmail grant owner
(`src/worker/agent/outreach-safety.ts`), so the model cannot route around it.
A refused draft returns `state: "blocked"` with the reason; nothing is drafted.

- **Suppressions** (`outreach_suppressions`): `opt_out`, `do_not_contact`,
  `bounced` or `manual`, on an address or a whole `@domain`. The model adds
  them with `outreach_safety` `suppress`; only an `outreach_unsuppress` card
  removes one.
- **Recipient history from Gmail, not memory:** an existing draft blocks a
  second. A cold draft to someone already emailed is refused; a follow-up must
  pass the `threadId` of a thread sent to them. Once they have written, only a
  reply in one of their threads is allowed. A bounce blocks the draft and adds
  a `bounced` suppression.
- **Attempt before the call** (`outreach_draft_attempts`): each allowed draft
  is recorded as `intent` before Gmail is called, then settled as `drafted`,
  `failed` (the call never happened) or `unknown` (it may have). The database
  admits one open attempt per recipient. An `unknown` attempt blocks further
  drafts to that recipient until Gmail shows exactly one draft with its
  subject, which resolves it, or the operator confirms `outreach_abandon`.
- **Unverifiable is a block:** if Gmail history cannot be read or has an
  unexpected shape, the draft is refused rather than assumed safe.

Standing grants cannot cover these rules: grants match exact kinds, and no
grant kind exists for drafts, `outreach_unsuppress` or `outreach_abandon`.
