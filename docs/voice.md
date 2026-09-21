# Voice calls

Use **Start a call** above the chat composer to talk with Downy. The preview uses
GPT-Live 1 over browser WebRTC: microphone and speaker audio travel directly
between the browser and OpenAI. A separate authenticated server connection passes
lookups to the existing Downy agent. Jev, workspace storage, and chat remain
the existing backend; the Mac Studio does not need to be awake. Lookups run on
the **Voice model** chosen in Preferences (default: the chat model) with a
compact voice prompt and the GTM tool bundle; see
[tool bundles](tool-bundles.md).

Voice can discuss and read existing workspace material, search and read the
web inline (`web_search`, `web_scrape`, `read_peer_agent`), run the
lead-sourcing runbook (`qualify_leads`, `slack_channels`, and the Treg proxy
tools, with `tool_treg_call` pinned in code to the people-search, work-email
and company-enrichment read endpoints and to `params` only), search and read
Gmail and **create Gmail drafts** (`gmail_email`, re-validated in the voice
policy against the strict search/read/create_draft schema; a draft is saved
for the caller to review and is never sent), and save a **new Markdown
report** when explicitly requested. Which tools each channel may call
is one table, `src/worker/agent/tool-channels.ts`; the voice allowlist, the
effect gate's name sets and the connection registry's channel lists are all
derived from it. It uses the existing `write` tool
with a voice-specific executor: a single `.md` filename directly under
`workspace/research/`, `workspace/reports/` or `workspace/drafts/`, up to 100,000
characters. It cannot overwrite files, alter raw browser captures, publish,
send, schedule, connect services or approve gates. Those tools remain hidden and
blocked at execution. Use chat controls for other actions and credential cards
for secrets. No agent tools were added.

For multi-source research the caller should not wait for, voice may start a
**read-only background research worker**. The voice `spawn_background_task`
schema accepts only a brief; the worker is recorded with `access: "read-only"`
and receives search, scrape, workspace and skill reads, and peer reads. Its
write, edit, delete, skill-authoring and local-hands tools are hidden and throw,
and it gets no MCP proxies, so a brief cannot reach connected services. The
parent saves the worker's document as a new note under `workspace/notes/` and
runs its normal completion turn in chat, exactly as for chat-dispatched tasks.
The call hears one acknowledgement that the task started; the lookup stays open
and the finish is announced from the durable task record, including on a later
call. "Started" is never spoken as "done".

A spoken draft request creates the draft directly; the spoken outcome comes
from the tool receipt ("saved, not sent", with a Drafts link in chat), and a
failed or timed-out draft is reported as unverified with no automatic retry.
To schedule a recurring task, create Airtable records or post to Slack from a
call, voice uses `stage_action`, which puts a proposal card in chat. Nothing
runs until the caller taps **Confirm and run** on that card; a spoken yes never
confirms it. See [staged actions](staged-actions.md).

Report writes check that the destination is new and read the saved content back
before returning `saved:true`. The voice handoff derives save/failure status from
tool results, not an assistant promise. Failed tool calls produce an explicit
failure receipt in chat and spoken feedback; a verified save gets a report link.
It speaks only the final answer, skipping planning preambles. The original
missing-`kind` background-task bug is also fixed for normal chat: the optional
category now defaults to `task`; the brief remains required.

## Operator setup

1. Create an OpenAI project API key with GPT-Live access and API billing. This is
   separate from Cloudflare Workers AI credits and ChatGPT subscription billing.
2. In Cloudflare Secrets Store, provision `DOWNY_OPENAI_API_KEY` in the same
   account/store used by Downy's existing secret references. Enter the value
   directly in Cloudflare's secure UI or a secure interactive secret command;
   never paste it into chat, commit it, or put it in a `VITE_` variable.
3. Set `DOWNY_VOICE_ENABLED=true` in the operator's Alchemy deployment environment.
   The config adds the Secrets Store binding and a SQLite `VoiceCall` Durable
   Object. Alchemy handles the DO class migration during the authorized deploy;
   this feature needs no D1 migration. Review the deployment before applying it.
4. After deployment, visit Downy over HTTPS behind Cloudflare Access. Tap
   **Start a call**, allow the microphone, and use **Enable sound** if Safari
   blocks playback. A missing secret, missing model access, or insufficient
   credit appears as a call error; text and dictation stay available.

The key is never sent to the browser. Session creation and all control requests
use the existing Access check, validate the agent, and require same-origin JSON
posts. Browser data-channel permissions allow only mute, unmute, and close;
delegation results and instructions come from the trusted server connection.
Disabling voice on a subsequent deploy should follow ending any open calls.

## Call behavior and retention

- Calls listen while speaking. Interrupt naturally. Lookups run through Downy's
  existing inference queue, with at most twelve model steps per lookup and thirty
  delegations per call. Completion receipts identify their original request,
  including after a progress question or correction. A correction is still
  respected; an older result is not presented as answering the revised question.
- Lookup receipts survive hangup. A subsequent call receives recent task status
  in its opening context and an explicit update when earlier work finishes.
  Heartbeats reconcile unfinished receipts with the agent's persisted results,
  without rerunning tools or model work. Unknown execution state is reported as
  unconfirmed, never invented progress. At most sixty receipts are retained;
  completed receipts are evicted first. Only bounded request/result text is saved.
- One call per agent. There is no automatic reconnect or replay of a paid
  creation request. After an interruption (network loss, provider close, the
  cap, a heartbeat failure) the panel offers **Reconnect**: a deliberate tap
  that starts a new call with a new id and a new paid session. Lookups still
  running from the interrupted call finish into the new one through the
  usual receipts. A hangup or leaving the screen does not offer it. Delegation IDs are recorded before dispatch; duplicates or
  worker recovery do not repeat the lookup.
- **Mute** disables the microphone track immediately. **End call**, navigation,
  tab backgrounding, and unmount release media tracks. Background/lock-screen
  listening is intentionally unsupported in this preview.
- Maximum call length: 15 minutes by default; the operator can set
  `DOWNY_VOICE_MAX_MINUTES` (5–120) at deploy time, and the panel shows the
  cap next to the clock. Inactivity: two minutes without input
  transcript activity. Browser heartbeats renew a 60-second lease. A dedicated
  DO alarm closes abandoned calls independently of the agent's task scheduler.
- Hangup sends `session.close`; the server waits for `session.closed`, retains
  final usage seconds, and retries closing after a connection failure. Losing a
  socket alone is not evidence of successful provider finalization. If session
  creation itself times out before returning an ID, Downy cannot confirm that
  provider-side creation was rolled back and does not retry it automatically.
- Voice refers to reports by title rather than spelling out paths or URLs.
  Successful workspace reads and verified report saves add clickable Files links
  to chat; failed reads and paths invented in model prose do not produce links.
- Captions stay visible after hangup. Server-side transcript receipts are queued
  durably before finalizing the call and retried if the chat agent is temporarily
  unavailable, including after a coordinator restart or a later call. Transcript
  delivery retries never repeat model work or tools. The queue stores bounded
  captions only, not audio.
- If delegation arrives before any caller captions, the server waits up to 1.5
  seconds for them outside the event queue. It asks the caller to repeat the
  question if no text arrives; it does not invent or replay a task.
- Read-only lookups already submitted can finish after hangup; results remain
  in chat. Hangup does not cancel or roll back accepted work.
- Downy saves **no audio recordings**. Session creation sets `store: false`.
  This does not override OpenAI's applicable service retention policies.
  Recent plain chat text seeds the call; hidden reasoning and tool payloads do
  not. Live captions are approximate, retain a bounded recent window, and are
  saved in the agent's chat at hangup. Lookups and their source references also
  remain in the normal conversation. Do not speak secrets into the call.

OpenAI currently lists GPT-Live at $0.05 per session minute, billed per second,
plus backend model/tool costs, with a startup charge credited against session
duration. Mute does not pause billing. Check the
[current model pricing](https://developers.openai.com/api/docs/models/gpt-live-1)
before enabling it.

## Acceptance and testing

Automated tests cover the request contract, browser permissions and cleanup,
mute, blocked autoplay, caption bounds, stale/duplicate delegations, expiry,
cross-origin rejection, server-secret isolation, execution-level action
restrictions, verified report saves, read-only research dispatch, and the
read-only worker tool set. They simulate the provider; they do not prove live audio quality or
account access.

Before treating this as live-ready, run a short call on desktop and on an iPhone
in Safari and home-screen mode, behind Access:

1. Ask about a known workspace digest; confirm the answer cites the same file
   in chat. Check a follow-up that needs another read.
2. Interrupt: “No, the second digest.” Confirm the correction is respected.
3. Ask to combine existing captures into a new report; verify the saved file
   and its link. Ask a question that needs the web and confirm an inline
   search answers it. Ask for a multi-source comparison you do not want to
   wait for; confirm the call says it started, the Background tasks view shows
   a read-only task, and the finish is announced with a note link in chat. Try an existing filename: it must not overwrite. Ask to publish
   or approve something; voice must direct you to chat without performing it.
4. Check mute, headphones, sound activation, microphone denial, and hangup.
5. Background the app and disconnect the network. Verify microphone release,
   the server close state, and no surprise reconnection or duplicated lookup.
6. Measure first-audio latency, useful lookup-answer latency, transcription of
   game-development names, and session usage against OpenAI billing.

Implementation references: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live),
[client delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[server control](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live),
and [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations).

### 2026-09-19 iPhone home-screen investigation

The operator reported that an example-CUA-pilot lookup failed in the iPhone PWA
and the captions disappeared on hangup; the laptop retry succeeded. The laptop
request and captions were present in the agent history, but a matching failed
phone call was not. The retained records do not establish the exact incident
cause or a platform-specific WebRTC defect.

Regression tests reproduced two concrete failure paths: a failed final transcript
save was never retried after the call closed, and delegation arriving before
caller captions dispatched no lookup. Durable transcript delivery and bounded
caption waiting fix those paths. The UI also retains its local captions after
hangup. A new physical iPhone PWA call is still needed to verify the original
experience after deployment.
