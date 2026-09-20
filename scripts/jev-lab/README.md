# Jev lab

Scratch experiments against TypeSafe's Jev (`typesafe/jev`) using the same
Workers AI binding path Downy uses in production. Not part of the app build.

## Run

Terminal 1 (proxy; uses your wrangler login, no TypeSafe key needed):

    cd scripts/jev-lab && npx wrangler dev -c wrangler.jsonc --port 8799 --remote

Terminal 2:

    cd scripts/jev-lab && node experiments.mjs            # all experiments
    node experiments.mjs E2-tool-routing                  # one experiment

Live check of the shipped effect gate (`src/worker/agent/effect-gate.ts`)
against the real model, with the proxy running; skipped without the flag:

    JEV_PROXY_LIVE=1 npx vitest run -c scripts/jev-lab/vitest.live.config.ts

To hit the TypeSafe API directly instead of the binding:

    TYPESAFE_API_KEY=... JEV_TRANSPORT=typesafe node experiments.mjs

`results.txt` holds the output from the 2026-09-20 run. Full write-up of the
research and findings: see the Jev section in `docs/backlog.md` and `docs/jev.md`.
