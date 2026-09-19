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
Requesting options again reuses an unanswered, unexpired ticket.

Selecting an option is a preference, not permission to execute. The server uses a
storage transaction to accept one selection. Repeating that selection is
idempotent; changing it returns a conflict with the winning choice. Pending
choices expire after 24 hours. A choice must still belong to the conversation.
After selection, deterministic user-preference and assistant-receipt messages
are appended directly, without invoking inference or tools. A retry or subsequent
GET repairs missing receipts after interruption. All selection buttons disable
when the selection is restored.

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
