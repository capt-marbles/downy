# Three-source evidence comparison pilot

Select the three-source comparison in chat, save three public URLs, then tap
**Start comparison with Studio**. Saving URLs alone does not start work. The
phone can close or hang up after starting; progress and the report persist.

This pilot uses the existing read-only Aside connector on **mac-studio**. It is
not a CUA execution test. Studio must be online and the URLs must satisfy its
existing public-host allowlist. Unsupported sites fail with a local-hands
diagnostic; the pilot does not expand browser permissions. Three idempotent,
Studio-pinned captures expire after 24 hours.

The currently selected Downy model generates 3–6 atomic findings, with exact
quotes from the captured text. This preserves the Boat/Codex provider when
selected; there is no silent provider or billing fallback. The draft step has
no tools and a 120-second deadline. Each source snapshot is capped at 8,000
UTF-8 bytes, with truncation recorded. The model cannot browse beyond these
snapshots. Quotes that do not occur verbatim in their cited snapshot always
fail, even if Jev approves them.

One `typesafe/jev` call evaluates source support (Choice), explicit contradiction
(Noul), and game-development relevance (Score) for every finding. A finding
passes only with supported probability >=0.8, native Choice confidence >=0.7,
and contradiction probability <=0.2. Contradiction >=0.8 is flagged; uncertain
answers go to review. Relevance uses its native 0–2 rubric and is not a
probability. These thresholds are provisional, not locally calibrated.
Jev errors, incomplete results, and the 10-second deadline leave findings
explicitly unassessed. They never produce a verified stamp or authorize an
external action. A claim can pass these checks and still be wrong in the world.

Inputs, draft, evaluated request, full validated response (including model and
usage), policy, hashes and Markdown report live under
`workspace/research/comparisons/<run-id>/`. Each retry creates a new run;
interrupted model work is not silently repeated. Completed runs only retry
notification delivery. Reports link directly from chat and the Files tab.

The review card includes all flagged findings and up to two passed findings
selected by a deterministic hash, so review is not restricted to known errors.
Human feedback is append-only and separate from model evidence, with server
timestamps and idempotent submission IDs. This is informed operator feedback,
not blinded ground truth or automatic training. It measures evidence support;
it does not measure LinkedIn engagement or business outcomes. Later policy
experiments can replay recorded answers; revised questions require a fresh
Jev evaluation on the frozen sources. Hold out cases before tuning thresholds.

## Acceptance checks

- One start creates exactly three Studio-pinned browser reads, including after
  restart; no model call while captures are pending.
- One selected-model draft and one batched Jev evaluation produce a saved report.
- Invented excerpts fail in code; missing/uncertain evaluation is visible.
- Refresh and hang-up preserve status and the report link.
- A saved correction does not modify the original Jev result.
- No new registered agent tools, dependencies, service worker, D1 migration,
  provider changes, publishing, or browser permission expansion.

## Initial verification, 2026-09-19

The local suite passes 224 tests, including quote forgery, contradiction,
uncertainty, outage/timeout, interrupted execution, storage failure, capture
idempotency and feedback preservation. `pnpm ci:check` and the production build
pass. A live Cloudflare call using synthetic evidence returned `jev-1.13.0` in
805 ms: the attributed claim passed, an explicit opposite claim was flagged as
contradicted, and an unsupported productivity claim failed. This is a transport
and behavior smoke test, not a calibration study. The full Studio-to-report
operator run awaits three selected URLs; iPhone hang-up acceptance is still to
be exercised on that run.

### First operator run: drafting recovery

All three selected GitHub pages were captured by Studio. Draft generation
failed: a replay showed Kimi consuming all 5,000 output tokens on reasoning,
returning no JSON. Comparison drafts now set Kimi K2.6's documented
`chat_template_kwargs.thinking=false` through a scoped AI binding wrapper;
normal chat, other providers and Jev are unchanged. The same frozen sources
then produced six schema-valid findings in 1,308 output tokens. Budget stops,
empty answers, malformed JSON and invalid citation schemas now have distinct,
code-owned error messages without leaking arbitrary provider errors.

An explicit retry after a drafting failure reuses the completed capture IDs
when the source revision is unchanged. Changing URLs or retrying an incomplete
capture creates new reads. Idle cards continue polling to observe a run started
from another client, and the UI distinguishes saving URLs from starting work.

The recovered production run `4f5469dc-3406-4614-aab7-5f133c295f9d`
reused all three capture IDs, completed with Kimi and `jev-1.13.0`, and saved
six findings: three supported, three requiring review. The report API returned
200 and its completion receipt/link were read back from chat. CI, build and
228 tests pass. The original absent start request could not be attributed to
a specific button/client failure; the subsequent Kimi failure was reproduced.
