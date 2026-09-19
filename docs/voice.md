# Voice calls

Use **Start a call** above the chat composer to talk with Downy. The preview uses
GPT-Live 1 over browser WebRTC: microphone and speaker audio travel directly
between the browser and OpenAI. A separate authenticated server connection passes
lookups to the existing Downy agent. Kimi, Jev, workspace storage, and chat remain
the existing backend; the Mac Studio does not need to be awake.

This first release is **read-only**. It can discuss the conversation and read
existing workspace material, such as an X research digest. It cannot publish,
send, schedule, change files, connect services, or approve gates. These tools are
both hidden and blocked at execution. Use the existing chat controls for actions
and credential cards for secrets. There are no new agent tools.

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
cross-origin rejection, server-secret isolation, and execution-level read-only
restrictions. They simulate the provider; they do not prove live audio quality or
account access.

Before treating this as live-ready, run a short call on desktop and on an iPhone
in Safari and home-screen mode, behind Access:

1. Ask about a known workspace digest; confirm the answer cites the same file
   in chat. Check a follow-up that needs another read.
2. Interrupt: “No, the second digest.” Confirm the correction is respected.
3. Ask to publish or approve something; verify voice directs you to chat and
   performs no write.
4. Check mute, headphones, sound activation, microphone denial, and hangup.
5. Background the app and disconnect the network. Verify microphone release,
   the server close state, and no surprise reconnection or duplicated lookup.
6. Measure first-audio latency, useful lookup-answer latency, transcription of
   game-development names, and session usage against OpenAI billing.

Implementation references: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live),
[client delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[server control](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live),
and [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations).
