# Cloud computer

Downy can run its reasoning service on Cloudflare Computer and a Cloudflare
Container, using Codex signed in with ChatGPT. Select **Cloud computer (ChatGPT
subscription)** in Settings after connecting. The existing model stays selected
until you change it. There is no automatic paid API fallback.

The chat shows confirmed lifecycle states: starting, ready, working, sleeping,
interrupted, and error. The existing tool cards show the actual reads, writes,
and saved artifacts. Starting a voice call warms the computer concurrently with
the audio connection. GPT-Live audio and Cloudflare compute still have their
own billing; Codex consumes the account's subscription allowance.

## Boundary

Downy retains its transcript, workspace, tools, workflow gates, and approval
controls. A private `CloudComputer` Durable Object serializes inference for the
personal account. It boots the Computer backend, which runs a pinned Codex App
Server in a Linux container. Only Downy's currently active tools are supplied.
Codex yields tool intent; Downy's existing Think loop executes it and records
the result. Voice therefore retains its narrower read/report tool surface.

The bridge uses a fresh ephemeral Codex thread for each model step. Downy's
persisted transcript, including recorded tool results, is the recovery source;
there is no competing Codex conversation database to synchronize. An interrupted
inference can be retried from that transcript. The bridge never executes a tool,
so container failure cannot replay an external side effect inside the bridge.
This first version returns completed model steps rather than token-by-token
text. Images, provider-native tools, forced tool choice, and structured response
formats fail explicitly. Ordinary text and function tools are supported.

This is an isolated preview, not an unrestricted remote shell. Native Codex
shell, browser, apps, MCP, and subagents are disabled; unexpected execution
items or server requests terminate the Codex process. The Studio remains the
connector for Aside and its authenticated X browser. No new agent tool is added.

## Login and recovery

1. Open Settings → Cloud computer → **Connect ChatGPT**.
2. Follow the OpenAI link and enter the one-time code. Device-code login may
   need enabling in the ChatGPT account's security settings.
3. After Downy reports connected, choose the cloud-computer model option.

Codex owns OAuth and refresh. Its plaintext auth file is in the disposable
private runtime directory, outside the Computer workspace. A watcher saves
updates as AES-GCM ciphertext in the Computer's durable SQLite-backed filesystem.
The existing `CREDENTIAL_KEY` Secrets Store binding supplies the encryption key
through a private bootstrap call. It is not in the image, model environment,
transcript, tool results, or browser responses. The private Computer filesystem
is separate from the R2 workspace Downy's agent tools can read.

Every model result waits for an auth checkpoint. On startup, the checkpoint is
decrypted before Codex starts. A single service owns token refresh. Status
polling does not keep waking a sleeping computer. Pending device login is polled
while awake. Invalid/revoked auth produces a reconnect state, preserving work.
Corrupt ciphertext fails closed rather than silently deleting the login.

A process crash exactly during a credential rotation can still precede its
checkpoint; provider revocation can also require sign-in. This design removes
routine login after container replacement, not OpenAI's authority to revoke a
session. Rotating CREDENTIAL_KEY requires migrating this encrypted checkpoint
along with the other encrypted credentials.

## Configuration and deployment

- `DOWNY_CLOUD_COMPUTER_ENABLED=true`: Alchemy provisions the optional container
  binding. Leave unset to retain the existing deployment topology.
- `DOWNY_CODEX_MODEL`: defaults to the existing subscription route's `gpt-5.5`.
- `CREDENTIAL_KEY`: existing Secrets Store binding, base64 32-byte key.
- `enable_ctx_exports`: required with Downy's existing compatibility date for
  Computer's private workspace proxy.
- One `basic` instance, 15-minute inactivity timeout, bounded inference queue.
- `@cloudflare/computer` and `computerd` are pinned to 0.3.1; Codex to 0.154.0.
  Wrangler 4.135.0 is used for the newer container networking runtime.

Computer is a preview with unstable APIs. Keep the pins together and rerun the
restart acceptance test when upgrading. The Node bridge is a separate runtime
with `.d.mts` contracts and protocol/vault tests; like the existing daemon
scripts, its JavaScript is outside the application's type-aware lint pass.

For an existing production deployment, preserve all current bindings and append
only the `CloudComputer` SQLite DO migration and container definition. No D1
migration is part of this feature. Do not run a broad infrastructure adoption or
D1 migration merely to enable this provider.

## Verification

`pnpm test`, `pnpm ci:check`, and `pnpm build` cover the application. The focused
cloud-computer tests cover credential rotation/recovery, corrupted ciphertext,
restricted tool handoff, unexpected native execution, absent subscription auth,
and browser endpoint boundaries.

Runtime acceptance:

1. Wake the computer and connect ChatGPT once.
2. Run a real tool handoff and save a report through Downy's workspace tools.
3. Restart the computer while idle; verify connected status and another real
   model/tool turn without signing in again.
4. Interrupt a model step; ensure it is reported as interrupted and its recorded
   Downy tool results remain available. Never claim an unfinished report saved.
5. Confirm voice still works and cannot use tools outside its existing grants.

The development acceptance test used the actual Cloudflare local runtime and
container, verified encrypted persistence, destroyed the container, then verified
ChatGPT authentication and a real Codex read-tool handoff from its replacement.
This is distinct from production account authorization and an iPhone voice test.

Production startup and the Access-protected status endpoint were also verified on
2026-09-19. The initial production ChatGPT authorization is completed through
Settings; it is not imported from the developer machine.
