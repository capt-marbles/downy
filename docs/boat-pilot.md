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

Prepared on 2026-09-19. Local validation: 140 tests pass, `pnpm ci:check`
passes, and the production build passes. Boat CLI authentication is complete
for the operator's `gameyedocker` account. The account reports
`canStart: false`, `checkoutRequired: true`, and `subscription_required`;
billing activation is the live-test blocker. No sandbox has been provisioned,
no new subscription purchased, and the Boat integration is not deployed yet.

Do not call this pilot accepted based only on unit tests or `ready` status.
Record timestamps, sandbox id, image/bridge revision, model and bounded
pass/fail evidence here after each live test. Never record credential values,
private desktop URLs, login codes, raw provider payloads or authorization headers.

| Test                  | Required evidence                                                                                     | Live result                 |
| --------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| Sign in once          | Connected and encrypted checkpoint acknowledged; real model/tool step                                 | Pending billing activation  |
| Stop/resume           | Provider reaches archived, then ready; new model/tool step works without login                        | Pending                     |
| Full OS reboot        | Boot id changes; service and authenticated model/tool step recover                                    | Pending                     |
| Research report       | Read bounded public sources through existing Downy tools; save a report and read it through Files     | Pending                     |
| Confirmation boundary | A confirmation-required action remains pending until operator approval; Boat never executes it itself | Pending                     |
| iPhone experience     | Status visible, report readable, voice survives reasoning warm-up                                     | Pending operator phone test |

The reboot test is separate from provider stop/resume. Read the Linux boot id
before and after a deliberate reboot while no work is running. A successful
authentication check alone does not prove a usable subscription model call.
Use a specific public research question; publishing, messaging and unrelated
external writes are not part of acceptance.

Rollback: select the previous provider in Downy, sleep the Boat sandbox, and
revoke its scoped service key when retiring the pilot. Do not delete the
sandbox or snapshots while acceptance evidence or recovery is still needed.
