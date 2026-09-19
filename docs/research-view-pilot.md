# Research view pilot

Open `/agent/<slug>/research`, or **Research & reports** above the chat input.
Tap **Build my view** / **Refresh with Jev** to arrange saved research documents.
Everything, CUA & browsers, and Reports first are bounded presets. This pilot
is a separate view linked from chat; it does not add a voice command or agent tool.

The React renderer and core composer are pinned to json-render 0.21.0 from npm.
The published package includes experimental composition despite the documentation
still describing it as unreleased. No fork or Vercel Gateway key is required.
The Cloudflare evaluator uses Downy's existing `runJev(env.AI, ...)`, unwraps
completed Workers AI responses, validates every choice, and records the model
version, completed evaluations, input tokens and elapsed time in the snapshot.

Only Markdown under `workspace/research/` and `workspace/reports/` is eligible.
At most twelve recent files of at most 128 KB each are read. The CUA preset filters
that bounded set. Cards contain literal source excerpts, not generated summaries.
Jev sees prepared title/kind labels and the layout request, not the document bodies
or raw file paths. Research text remains untrusted evidence.

Jev can select and arrange fixed card candidates. It cannot modify document
contents, saved status or destinations. The UI resolves a card's record ID against
server-owned records and constructs the scoped workspace link. A final check
requires every supplied record exactly once. Invalid, omitted, incomplete or timed
out compositions fall back to a fixed list; they never hide a supplied file.
No credentials, action handlers, operator gates or publishing tools are exposed.

The composer has a two-evaluation budget and a 12-second deadline. Cancellation
stops waiting and discards late results; it does not guarantee that the underlying
Workers AI inference or billing was cancelled. No provider fallback is configured.

GET `/api/research-view?agentSlug=<slug>` restores the latest DO snapshot without
inference. On restore, changed or removed files are dropped and the view requests
a refresh. POST on the same route, with `view=all|cua|reports`, reads current files,
composes and persists the new snapshot. The existing Access and active-agent
checks apply; POST also requires same origin. Concurrent builds share one pending
operation. No migration, new secret, cron, or change to the Boat/Codex path.

## Acceptance evidence

- Initial live run: eight documents, Jev `jev-1.13.0`, two evaluations,
  7,450 input tokens, 1.391 seconds for composition. All eight file endpoints
  returned HTTP 200. This is one observed run, not a latency guarantee.
- Desktop cards rendered under Reports & briefs and Browser captures.
- A 390 × 844 browser viewport rendered a single column; actual iPhone/PWA
  acceptance remains for the operator.
- Reload restored the saved layout without invoking composition.
- Automated coverage includes response adaptation, missing/unoffered choices,
  cancellation, real composer ordering, omission fallback, provider failure,
  empty input, cyclic/invented records, path traversal, cross-origin requests,
  GET restoration and literal source excerpts.
- Subsequent live CUA/browser and Reports first runs both completed with eight
  matching records and two evaluations (0.798 s and 0.406 s respectively).
  Repeated GETs preserved the same generation timestamp and identical spec.
- Final validation: 168 tests passed; `pnpm ci:check` and `pnpm build` passed.
