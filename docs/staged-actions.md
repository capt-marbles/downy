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

`stage_action` and `list_staged_actions` are in the voice allowlist. The voice
turn is told to say the proposal is in chat awaiting a tap, and the spoken
outcome is derived from the tool receipt, not from the model's prose: "drafted"
or "scheduled" in the reply is replaced by "Nothing has run". The live
instructions repeat that a spoken yes does not confirm.

## Not yet covered

- Editing a proposal on the card. Ask the agent for a revised proposal; it
  creates a new card and the old one can be cancelled.
- Sending email, CRM writes, publishing. The kinds above are the only
  executors; adding one means adding an executor with the same
  confirmed/failed/unknown contract, not widening a payload.
