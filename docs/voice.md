# Voice calls

Use **Start a call** above the chat composer to talk with Downy. The preview uses
GPT-Live 1 over browser WebRTC: microphone and speaker audio travel directly
between the browser and OpenAI. A separate authenticated server connection passes
lookups to the existing Downy agent. Kimi, Jev, workspace storage, and chat remain
the existing backend; the Mac Studio does not need to be awake.

Voice can discuss and read existing workspace material and save a **new Markdown
report** when explicitly requested. It uses the existing `write` tool with a
voice-specific executor: a single `.md` filename directly under
`workspace/research/`, `workspace/reports/` or `workspace/drafts/`, up to 100,000
characters. It cannot overwrite files, alter raw browser captures, publish,
send, schedule, connect services, approve gates or dispatch general background
workers. Those tools remain hidden and blocked at execution. Use chat controls
for other actions and credential cards for secrets. No agent tools were added.

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
  existing inference queue, with at most eight model steps per lookup and thirty
  delegations per call. An older result is supplied as quiet context when newer
  speech has arrived, rather than spoken over the correction.
- One call per agent. There is no automatic reconnect or replay of a paid
  creation request. Delegation IDs are recorded before dispatch; duplicates or
  worker recovery do not repeat the lookup.
- **Mute** disables the microphone track immediately. **End call**, navigation,
  tab backgrounding, and unmount release media tracks. Background/lock-screen
  listening is intentionally unsupported in this preview.
- Maximum call length: 15 minutes. Inactivity: two minutes without input
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
cross-origin rejection, server-secret isolation, and execution-level action
restrictions and verified report saves. They simulate the provider; they do not prove live audio quality or
account access.

Before treating this as live-ready, run a short call on desktop and on an iPhone
in Safari and home-screen mode, behind Access:

1. Ask about a known workspace digest; confirm the answer cites the same file
   in chat. Check a follow-up that needs another read.
2. Interrupt: “No, the second digest.” Confirm the correction is respected.
3. Ask to combine existing captures into a new report; verify the saved file
   and its link. Try an existing filename: it must not overwrite. Ask to publish
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
