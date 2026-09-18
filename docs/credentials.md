# Secure connection credentials

The agent must never request a secret in chat. `request_credential` returns a
15-minute ticket and field descriptions. Password inputs submit directly to
`POST /api/credentials/:ticketId`; values never become chat messages or tool inputs.
A ticket is single-use. Connection failures return fixed errors, not vendor bodies.
Basic fields accept `username:password` and are encoded server-side.

This account has Cloudflare Secrets Store. Alchemy binds `CREDENTIAL_KEY` to the
existing store secret `DOWNY_CREDENTIAL_KEY`. Provision that secret out of band as
base64 of 32 random bytes before deployment. No keys are committed or provisioned
by this change. MCP headers use a random AES-256-GCM data key per write, itself
wrapped with the master key. Agent and server IDs are authenticated associated data.
The MCP SDK receives credentials through a fetch closure so its separately
persisted transport options cannot contain plaintext headers.

After deployment, POST `/api/credentials/migrate` with `x-agent-slug` for each
agent to run the idempotent one-shot migration. It encrypts legacy DO registrations
and removes plaintext copies from SDK transport options. Restore also migrates
legacy records on access. Migration is application code because these blobs live
in Durable Object storage, not D1. Keep the key backed up; rotating it requires
re-encryption before retiring the old key. No migration has been run on live data.

Old secrets already present in historical chat transcripts are not erased by this
change. Rotate them and handle transcript retention separately.
