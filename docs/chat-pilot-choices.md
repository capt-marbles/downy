# Chat option-card pilot

In agent chat, tap **Choose a CUA pilot**. During a voice call, ask **Show me CUA
pilot options**. The bounded voice shortcut handles that request before an agent
turn; it does not make arbitrary chat responses into cards.

The three prepared proposals are reading one public page, comparing three
sources, and recovering from a broken link on a local fixture. They describe
prerequisites and success criteria; they do not claim that CUA is installed.
Estimated run times exclude setup.

The actual json-render composer uses the existing Cloudflare Jev evaluator to
arrange fixed components and option IDs. The budget is two evaluations and twelve
seconds. Every option must appear exactly once; omissions, invalid trees and
provider failures produce the complete fixed list. Jev supplies no action
handlers, URLs or executable code, and never selects or approves an option.

The resulting spec and model attribution are stored in the agent Durable Object.
A persisted `data-pilot-choice` message part references that record. Plain text
descriptions stay in the message for agent and voice context; chat renders the
interactive cards instead. Reload reads the saved result without inference.
Requesting options again reuses the current unexpired ticket, including a saved
selection, so its source-entry form remains easy to find.

Selecting an option is a preference, not permission to execute. The server uses a
storage transaction to accept one selection. Repeating that selection is
idempotent; changing it returns a conflict with the winning choice. Pending
choices expire after 24 hours. A choice must still belong to the conversation.
After selection, deterministic user-preference and assistant-receipt messages
are appended directly, without invoking inference or tools. A retry or subsequent
GET repairs missing receipts after interruption. All selection buttons disable
when the selection is restored.

Voice must delegate both showing cards and explicit selection, even if the
options are already in its context. A bounded server router recognizes named
options and ordinals in the latest user caption within a CUA conversation. It
uses the same selection transaction as a tap and confirms success only after
the save. Ambiguous, negated and unrelated replies do not change the choice.
This does not make spoken approval authorize task execution.

Selecting the three-source comparison reveals three URL fields. **Save sources**
stores three distinct HTTP(S) URLs without embedded credentials; **Update sources**
can revise them. Each revision has an idempotent receipt in chat for subsequent
agent context. No page is fetched and no research begins when saving. POST with
`ticket=<id>&sources=1` accepts `{ urls: [...] }`. Existing selected cards continue
refreshing while open so changes from another device are visible.

GET `/api/pilot-choices?ticket=<id>` restores a choice. POST without a ticket
creates or reuses one; POST with `ticket` and `option` selects it. Existing Access
and active-agent checks apply; writes require same origin. Responses are private
and uncached. This adds no agent tools, dependencies, migrations or secrets.

## Acceptance evidence — 2026-09-19

- Live composition used `jev-1.13.0`, two evaluations, 1.448 seconds, and a
  vertical list with all three options. This is one observed run.
- Reload, repeated GET, and repeated creation retained the same pending ticket,
  layout and attribution without another evaluation.
- Desktop and 390 × 844 browser layouts rendered the cards. At phone width,
  each card was 317 pixels wide, buttons were 44 pixels high, and the document
  had no horizontal overflow. The chooser button scrolls existing cards into view.
- The live choice was deliberately left unanswered for the operator. Selection,
  expiry, conflicts, restored disabled buttons, failure fallback, and latest-user
  voice matching are covered by automated tests. Physical iPhone/PWA selection
  and the spoken request still need operator acceptance.
- `pnpm ci:check`, `pnpm test` (183 tests), and `pnpm build` passed.

## Voice handoff correction

The first physical call correctly described the choices but did not delegate to
the backend; inspection found `selectedId: null` after the spoken comparison
choice. Voice was answering from the cards in historical context. The follow-up
explicitly requires delegation, adds the server selection router, and provides
URL entry on the card. The reported wording is a regression fixture. Automated
validation now includes source validation, editing, restoration and voice choice
routing (198 tests). A fresh physical call is still needed to verify that the
speech provider follows the delegation instruction end to end.

The reported comparison preference was recovered through the selection endpoint
after deployment. GET and repeated show requests retained `source-comparison`,
and both preference and receipt appeared in chat. The three empty URL fields
were verified at 390-pixel width (283 pixels wide, 44 pixels high, no horizontal
overflow). Sources remain for the operator to supply; no research was triggered
by this recovery.
