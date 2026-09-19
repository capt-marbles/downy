# Boat alternative computer pilot

Boat is an optional execution host for the same restricted Codex App Server
bridge used by Cloudflare Computer. It is a separate model choice, **Boat pilot
(ChatGPT subscription)**, and has its own Settings card, login and encrypted
credential checkpoint. Cloudflare Computer stays available. No automatic model
switch or paid API fallback occurs.

Downy owns the transcript, workspace, scheduled work, active tool grants and
confirmation gates. The Boat bridge only returns text or tool intent. It never
uses Boat's managed `/prompt` harness, executes native Codex tools, or receives
the Boat account API key. The Studio connector still owns authenticated Aside/X
research. A Boat desktop or browser is not granted to the model by this pilot.

## Provisioning

Use a dedicated `small` sandbox with `noEnv: true`, no cloned credentials and a
two-hour TTL. Verify the signed-in Boat account before provisioning. Do not
import the operator's local Codex login. The platform's included trial or an
existing plan may cover the pilot; do not purchase a plan as an implicit setup
step. Stopped compute has no usage charge, but a paid account has a monthly
minimum. See <https://docs.boat.dev/pricing>.

Generate the secret-free setup script:

```sh
node scripts/boat-pilot-bundle.mjs /tmp/downy-boat-setup.sh
boat new --type small --no-env --ttl 7200 --setup-file /tmp/downy-boat-setup.sh
```

Wait for setup to finish. Upload a separately generated random bridge token to
`/home/user/.downy-boat/bridge-token` (0600) via SCP/file upload, never a shell
argument or model prompt. Start `downy-boat.service`. The service uses the same
Codex version as the CF bridge, pinned to 0.154.0. Host port 8789 privately.

Configure the Worker:

- `DOWNY_BOAT_ENABLED=true`: optional `BoatComputer` SQLite DO binding.
- `BOAT_SANDBOX_ID`: this one sandbox's id. The Worker cannot provision more.
- `BOAT_API_KEY`: a service key restricted to this sandbox and its lifecycle
  and port-hosting operations. Do not give it arbitrary command execution.
- `BOAT_BRIDGE_TOKEN`: the independent random bridge token.
- `BOAT_CREDENTIAL_KEY`: a separate base64 32-byte AES key, never the shared
  MCP/Cloudflare credential encryption key.
- `DOWNY_CODEX_MODEL`: the existing pinned subscription model.

Store secrets through the existing Cloudflare Secrets Store, outside chat.
Alchemy secret names are `DOWNY_BOAT_API_KEY`, `DOWNY_BOAT_BRIDGE_TOKEN`, and
`DOWNY_BOAT_CREDENTIAL_KEY`. Preserve existing production bindings and add only
the Boat DO migration; no D1 migration or broad Alchemy adoption is needed.

In Downy Settings, use the **Boat pilot** card to wake and connect ChatGPT using
Codex's device login. This pilot does not use Boat's account-wide subscription
sync. The login lives in `/run/downy-boat` (ephemeral); only an encrypted envelope
is saved under `/home/user/.downy-boat` and acknowledged in DO storage. Codex
owns token refresh. Neither secret nor encrypted envelope appears in the UI or
agent context. Provider revocation may still require sign-in.

The service is supervised by systemd and comes back after reboot/resume. Idle
sleep occurs after 15 minutes, with an acknowledged checkpoint before stopping.
The two-hour provider TTL is a cost backstop and is renewed on work. Polling the
status card does not wake the VM. Boat's disk snapshots do not preserve running
processes; see <https://docs.boat.dev/snapshots>.

## Acceptance record

Provisioned and deployed on 2026-09-19 after the operator enabled billing.
Sandbox `bx_k7y88evu` is a dedicated small machine with a two-hour TTL and a
systemd-supervised Codex 0.154.0 bridge. Downy can wake it through its restricted
service key. The key expires on 2026-09-26 and must be rotated if the pilot
continues. No D1 migration was run. Cloudflare Computer remains available.

Local validation: 142 tests pass, `pnpm ci:check` passes, and the production build
passes. Live bridge health, initialization and the Worker wake endpoint pass.
The private Boat port gate requires a token-to-cookie handshake; Downy performs
that separately before sending bridge credentials. Redirects on credential-bearing
requests are rejected using Workers-supported manual redirect handling.

Deployment: `5044859e-7e3c-459f-86a8-d8a613cb49b2`. The operator signed into
ChatGPT once. Downy acknowledged the encrypted checkpoint and ran real
`gpt-5.5` tool steps before and after stop/resume and OS reboot. No API fallback
was used. Each test temporarily selected Boat and restored the previous
server-side provider afterward.

Do not call this pilot accepted based only on unit tests or `ready` status.
Record timestamps, sandbox id, image/bridge revision, model and bounded
pass/fail evidence here after each live test. Never record credential values,
private desktop URLs, login codes, raw provider payloads or authorization headers.

| Test                  | Required evidence                                        | Live result                                                                                |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Sign in once          | Connected, checkpoint acknowledged, real model/tool step | Passed: report read, 34.7s                                                                 |
| Stop/resume           | Snapshot stop then awake; model/tool step without login  | Passed: snapshot at 19:22:25 UTC; report read, 42.4s                                       |
| Full OS reboot        | Changed boot id; service and model/tool step recover     | Passed: systemd active and browser queue tool succeeded without login                      |
| Research report       | Fresh public capture, report write and Files read        | Passed: report saved and read back; desktop Files rendered                                 |
| Confirmation boundary | Required action remains pending, no execution            | Passed: caller false could not bypass filesystem.fetch confirmation; test request rejected |
| iPhone experience     | Status visible, report readable, voice warm-up works     | Voice passed (operator reported); phone Files/status checks unconfirmed                    |

The deliberate OS reboot changed the boot id from
`e47bc773-a565-4366-a4a1-f2c63181a875` to
`7c715933-3f4b-4f56-a7a3-cec8fee7fee3`. Both authenticated status and a
real Downy tool call were verified afterward.

The first post-reboot browser prompt returned a report of an unavailable native
`request_user_input` tool and created no action. A bounded retry explicitly
pointing at the dynamic Downy function queued successfully (11.7s). This is a
model/tool-selection reliability finding, not proof of a hosting defect; track
it before promoting Boat to the default. No automatic retry or broad native
capability was enabled to hide it.

The Studio rejected `docs.boat.dev` under its existing public-host allowlist.
The permitted `github.com/trycua/cua` capture then completed as
`hands-1789846109006-3210d2b3`, with one source. The negative confirmation test,
`hands-1789846083014-b3ae6308`, remained unclaimed with no result and was rejected
by the tester. No local file was transferred. The report is
`workspace/research/boat-pilot-2026-09-19.md` (3,870 characters), saved and read
back by the model in 124.6s, then independently retrieved through the Files API
and rendered in the desktop Files UI. No archive error occurred. This timing
includes multiple model/tool steps and is not a single inference latency.

On 2026-09-19 the operator confirmed a successful call from iPhone and supplied
Downy's approximate captions. The request was “Summarize the Boat Pilot CUA
report.” Downy returned a summary consistent with the saved report, identified
the single captured GitHub page and unverified benchmarks, suggested the same
follow-ups, and gave the report path. The operator confirmed the answer was
helpful and the conversation continued normally. This establishes the phone
voice round trip from operator-reported evidence; it is not an audio recording
or a measured latency test.

The supplied transcript does not establish whether the wake/working status was
visible or the report was opened in Files on the phone. Those visual checks
remain unconfirmed. It also shows Downy speaking the full workspace filename;
a useful follow-up is to use a short spoken report title and provide a tappable
Files link in chat. No provider default or voice behavior changed when recording
this result.

The reboot test is separate from provider stop/resume. Read the Linux boot id
before and after a deliberate reboot while no work is running. A successful
authentication check alone does not prove a usable subscription model call.
Use a specific public research question; publishing, messaging and unrelated
external writes are not part of acceptance.

Rollback: select the previous provider in Downy, sleep the Boat sandbox, and
revoke its scoped service key when retiring the pilot. Do not delete the
sandbox or snapshots while acceptance evidence or recovery is still needed.
