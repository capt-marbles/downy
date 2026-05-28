# Campaign Room User Manual

This is the operator manual for getting Downy's Campaign Room running quickly on the hosted Worker plus a local "hands" machine such as the Mac Mini or Omarchy PC.

## What Campaign Room does

Campaign Room is a GTM workspace inside the `buildroom` Downy agent. It turns GTM prompts into structured workflows and artifacts before anything gets published, sent, or mutated externally.

Current loop:

```text
Campaign Room UI
  -> /api/campaign-room/smoke
  -> Buildroom job
  -> campaign-content-v1 workflow
  -> campaign-brief artifact
  -> placeholder campaign-source-notes artifact
  -> queued grok.research local-hands action
  -> local hands daemon
  -> Grok/X adapter
  -> completed campaign-source-notes artifact
```

The important safety rule: research is read-only. Posting, sending email, liking, DMing, following, CRM updates, and destructive local actions are not allowed without a separate explicit confirmation gate.

## Fast start checklist

### 1. Update your local machine

On the Mac Mini or Omarchy PC:

```bash
git clone https://github.com/capt-marbles/downy.git
cd downy
pnpm install
```

If the repo already exists:

```bash
cd /path/to/downy
git pull fork main || git pull origin main
pnpm install
```

### 2. Confirm the deployed UI

Open:

```text
https://downy.andrewdmwalker.workers.dev
```

Expected:

- It opens the `buildroom` agent.
- Left sidebar has a **Campaign Room** box.
- The box shows `flows`, `presets`, `jobs`, and **Run smoke path**.

If the box is missing, hard refresh the browser.

### 3. Run Campaign Room smoke from the UI

Click **Run smoke path**.

Expected:

- `jobs` increments.
- A Buildroom job is created.
- A campaign workflow starts.
- `campaign-brief` and placeholder `campaign-source-notes` artifacts are written.
- A `grok.research` local-hands action is queued.

At this point the action will stay queued until a local hands daemon runs.

### 4. Smoke the Grok adapter locally

This does not need X/Grok auth. It proves the adapter script runs and emits the right shape.

```bash
pnpm grok:adapter:smoke
```

Expected JSON includes:

- `summary`
- `sources`
- `claims`
- `opportunities`
- `open_questions`
- `research_limits`

### 5. Run local hands in fixture mode

Use fixture mode first. It should claim the queued `grok.research` action and replace the placeholder `campaign-source-notes` with fixture research.

Mac Mini:

```bash
DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
DOWNY_HANDS_CONNECTOR_ID=mac-mini \
DOWNY_HANDS_ALLOWED_ROOTS=/Users/awalker/downy \
DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
DOWNY_GROK_ADAPTER_FIXTURE=1 \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
pnpm hands
```

Omarchy PC:

```bash
DOWNY_URL=https://downy.andrewdmwalker.workers.dev \
DOWNY_AGENT_SLUG=buildroom \
DOWNY_HANDS_CONNECTOR_ID=omarchy \
DOWNY_HANDS_ALLOWED_ROOTS=/home/awalker/downy \
DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
DOWNY_GROK_ADAPTER_FIXTURE=1 \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
pnpm hands
```

If Cloudflare Access service-token variables are missing or wrong, the daemon will fail before claiming actions. That is expected.

### 6. Run one poll only

For a safer first test, add:

```bash
DOWNY_HANDS_ONCE=1
```

Example:

```bash
DOWNY_HANDS_ONCE=1 \
DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
DOWNY_GROK_ADAPTER_FIXTURE=1 \
pnpm hands
```

Expected terminal output:

```text
Downy hands connecting to ...
claimed hands-... (grok.research, read_only)
```

Then refresh Downy and inspect the Campaign Room artifacts or local-hands action result.

## Real Grok/X research setup

Fixture mode is only a dry smoke. Real research uses a local provider command behind the wrapper.

```bash
DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
DOWNY_GROK_ADAPTER_CMD=/path/to/your/local-x-or-grok-command \
pnpm hands
```

The provider command receives:

```bash
DOWNY_GROK_RESEARCH_JSON
DOWNY_GROK_RESEARCH_QUERY
DOWNY_GROK_RESEARCH_MODE
DOWNY_GROK_RESEARCH_MAX_RESULTS
DOWNY_GROK_RESEARCH_OUTPUT_ARTIFACT
DOWNY_GROK_RESEARCH_CONTEXT
```

It should print JSON like:

```json
{
  "summary": "What Grok/X found",
  "sources": [
    {
      "url": "https://x.com/...",
      "title": "...",
      "source_type": "x",
      "confidence": "medium"
    }
  ],
  "claims": ["Source-backed claim"],
  "opportunities": ["GTM/content/lead opportunity"],
  "open_questions": ["What still needs checking"],
  "research_limits": "What was searched and what was not"
}
```

Plain text output also works. The wrapper extracts URLs and stores the text as the summary, but JSON is better.

## What each command does

| Command                         | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `pnpm grok:adapter:smoke`       | Local dry smoke for adapter output shape                  |
| `pnpm hands`                    | Starts the local hands polling daemon                     |
| `DOWNY_HANDS_ONCE=1 pnpm hands` | Claims at most one queued action, then exits              |
| `pnpm hands:smoke`              | Creates and runs a read-only Jcode local-hands smoke test |
| `pnpm run deploy`               | Deploys Downy to Cloudflare via Alchemy                   |

## Troubleshooting

### Campaign Room box is missing

Hard refresh the browser. If still missing, confirm the deployed commit includes:

```bash
git log --oneline -5
```

You should see:

```text
7fba803 Add Grok research adapter writeback
a9b10c4 Add Campaign Room workspace smoke path
```

### Local hands reaches Cloudflare Access login

Set service-token headers:

```bash
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
```

The daemon is non-browser code, so normal browser login cookies are not enough.

### Local hands claims no action

Run **Run smoke path** in the UI first. Then run:

```bash
DOWNY_HANDS_ONCE=1 pnpm hands
```

Also confirm `DOWNY_AGENT_SLUG=buildroom`.

### Grok adapter fails because no provider command is set

Use fixture mode first:

```bash
DOWNY_GROK_ADAPTER_FIXTURE=1
```

For real research, set:

```bash
DOWNY_GROK_ADAPTER_CMD=/path/to/provider
```

### Research completes but source notes stay placeholder

Make sure the queued action was created by Campaign Room smoke, not by a manual action without context. Writeback requires:

- `context.jobId`
- `outputArtifact=campaign-source-notes`
- JSON output from the adapter

### Keep actions safe

Do not give the provider command posting or account mutation behavior. It should only read/search/summarize. Any external side effect should become a separate Downy action requiring explicit operator confirmation.

## Recommended tomorrow sequence

1. Pull latest repo on Mac Mini or Omarchy.
2. `pnpm install`
3. `pnpm grok:adapter:smoke`
4. Open Downy and click **Run smoke path**.
5. Run fixture hands once:
   ```bash
   DOWNY_HANDS_ONCE=1 \
   DOWNY_HANDS_GROK_RESEARCH_CMD="$PWD/scripts/grok-research-adapter.mjs" \
   DOWNY_GROK_ADAPTER_FIXTURE=1 \
   CF_ACCESS_CLIENT_ID=... \
   CF_ACCESS_CLIENT_SECRET=... \
   pnpm hands
   ```
6. Confirm source notes changed from placeholder to fixture output.
7. Install and smoke Roughdraft for review loops:
   ```bash
   npm i -g roughdraft
   roughdraft status --json
   pnpm exec -- node -e "console.log('# Campaign Room Review Smoke\n\nReview me.')" > /tmp/campaign-room-review-smoke.md
   roughdraft open /tmp/campaign-room-review-smoke.md --no-watch --print-url
   ```
8. Add the Roughdraft local-hands integration after Grok writeback is proven:
   - action kind: `roughdraft.review`
   - input: Markdown review package plus target artifact metadata
   - executor: `roughdraft open <file.md> --json`
   - output: reviewed Markdown, feedback counts, overall comment, and CriticMarkup comments
   - writeback: Campaign Room review artifact or workflow gate decision
9. Replace fixture mode with the real `DOWNY_GROK_ADAPTER_CMD`.
10. Run another Campaign Room smoke and verify real Grok/X research writes back.
11. Export a draft/review package to Roughdraft and confirm the agent can read your comments.

## Reference docs

- `docs/campaign-room.md` for the Campaign Room design/spec.
- `docs/local-hands.md` for the local hands protocol and executor details.
- `docs/buildroom-handoff.md` for the broader Buildroom development context.
