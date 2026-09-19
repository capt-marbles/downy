# Pilot: AI developments for game development from X

Status: selected pilot candidate, recorded 2026-09-18. The operator specified
their local Aside browser MCP on the Mac Studio. The live MCP connection and
adapter have not been verified by this planning change; no schedule is enabled.

The operator also nominated **Taskfuel and Treg** as candidate data connectors.
Catalog discovery on 2026-09-18 confirmed relevant endpoints and connected local
CLI accounts (Taskfuel account verified; Treg active org: Gameye). That does not
prove they are connected to Downy's Worker or installed/authenticated on Studio.
No paid searches or provider calls were made during discovery.

## Purpose and outcome

Find verified, previously unknown AI developments worth evaluating for game
development. Proposed output: up to five findings with what changed, the game
development use case, source links, availability, limitations, and a suggested
next step. An empty digest is valid; never fill a quota with weak findings.

Proposed starting coverage: coding and engine tooling, assets and animation,
NPC behavior, testing, and production workflows. Keep broad industry news
separate unless there is a concrete game-development implication.

Define the search window, query set, review-time budget, and useful-finding
criteria before each pilot run. Measure verified useful findings, duplicates,
unsupported claims, missed findings discovered during review, and operator
review time. Likes and repost counts are context, not labels of usefulness.

## Execution boundary

- Queue `kind: "x.research"`, `riskLevel: "read_only"`, and
  `targetConnectorId: "mac-studio"` through the existing local-hands request.
  Bind this pilot to the Studio's Aside backend in trusted local configuration,
  not just in the research prompt. No laptop or silent alternate-provider fallback.
  Taskfuel/Treg are explicit comparison branches described below, not substitutes
  for a failed or sleeping Studio action.
- The Studio adapter calls the local Aside browser MCP using its actual advertised
  interface. Discover and validate that interface on the Studio before writing
  the bridge; do not assume it matches jev-ultrafast's Chrome/CDP interface.
- X authentication stays in the local browser. Return only the selected research
  evidence; do not export cookies, credentials, unrelated tabs, or browser history.
- Enforce research-only operations in the adapter. Search, navigate, and read;
  no posting, replying, liking, following, DMs, or account changes. Jev cannot
  widen these grants. Page content is evidence, not instructions.
- If Studio is offline, keep the work visibly queued. Use a finite expiry
  (proposed 24 hours) and avoid overlapping or duplicate scans. Expiry is not a
  successful empty scan; an incomplete scan must not advance the coverage cursor.

The current daemon can invoke a local provider command for `x.research` through
`DOWNY_HANDS_GROK_RESEARCH_CMD`, despite that setting's historical name. The
bundled adapter can normalize output, but does not itself implement an Aside
connection. The dedicated `request_grok_research` shortcut does not expose
connector targeting; use the generic request for this pilot.

## Candidate API collection branches: Taskfuel and Treg

These connectors can supply structured candidates for the same Jev triage pass.
They may reduce browser work, but their coverage and freshness must be measured.
Aside remains the nominated browser path for X, including inspecting selected
posts and context when API results are incomplete. Neither catalog is ground truth.

Discovery receipts (catalog prices, not a spend authorization or live quote):

| Connector | Candidate endpoint                              | Documented capability                                        | Catalog price on review date             |
| --------- | ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Taskfuel  | `GET https://x402.ottoai.services/tweet-search` | Query search, newest first, author/text/timestamp/engagement | $0.005 per call                          |
| Treg      | `tikhub.x.twitter-web-fetch-search-timeline`    | Keyword, cursor, search-type parameters                      | $0.001 per successful call               |
| Treg      | `treg.x.search.posts`                           | Routed search with provider attribution                      | Child-dependent: $0.001–$0.01476 per hit |

Taskfuel's reviewed endpoint docs do not expose a pagination parameter or specify
the result limit. Treg's direct endpoint shows a cursor, but its example uses
`search_type=Top`; verify supported chronological mode and time filters rather
than assuming them. The routed Treg endpoint exposes a narrower query contract,
so prefer an explicit child endpoint for the first controlled comparison.

Reproduce discovery without running a search:

```bash
taskfuel discover GET https://x402.ottoai.services/tweet-search
treg catalog get tikhub.x.twitter-web-fetch-search-timeline
treg catalog get treg.x.search.posts
```

Compare on a small, fixed query set and the same time window before choosing a
default collector. Record search mode, pagination limits, cache/freshness evidence,
provider actually used, latency, paid amount, and failures. Normalize post IDs and
retain all source provenance while deduplicating the union. Agreement between two
gateways serving the same upstream is not independent corroboration.

Assess verified useful findings, additional findings unique to each source,
missed items found in the comparison, review time, and total cost. This estimates
coverage relative to the observed comparison set, not recall over all of X.
Review a sample of rejected items without provider or Jev scores influencing
the initial label. Do not tune the rubric to make a preferred provider win.

Before any paid pilot, define a total run budget including pagination, retries,
verification, and Jev calls. Quote the exact first Taskfuel request and enforce
`--max-amount`; check Treg's current price and record actual charge receipts.
Avoid the routed endpoint's default $1 waterfall for this small experiment:
pin a provider or set an explicit route ceiling and fallback policy. Reconcile
uncertain charges instead of repeating calls blindly; use supported idempotency
for genuine retries, with new IDs for fresh scans.

If an API collector later runs in the Worker, use the existing secure credential
entry/persistence path. Local CLI sign-in is not a Worker credential. Expose only
approved research endpoints to the job; broad catalogs include write operations
that this pilot must not acquire. No uploading local keys or reviving revoked
Exa/OpenRouter credentials is part of this plan.

## Collection, judgment, and feedback

1. Collect a bounded candidate set using recorded queries and time windows.
   Preserve canonical post URLs/IDs, authors, posted and observed times,
   relevant excerpts, linked sources, and collection limits. Record failed
   searches, authentication problems, and unavailable content explicitly.
2. Deduplicate post IDs and group coverage of the same development in code.
   Preserve history so an old announcement reposted today is not automatically
   classified as a new development. Do not claim exhaustive X coverage.
3. Use Downy's existing Workers AI Jev binding for specific questions about
   relevance, concrete availability, evidence, and novelty relative to supplied
   history. Record model/question versions and uncertainty. Jev cannot establish
   global novelty from a post alone, and does not replace source verification.
4. Check shortlisted claims against linked primary evidence. Distinguish a
   vendor's assertion, a documented release, and independently tested capability.
   Use the existing Campaign Room/workspace output path for the digest and receipts.
5. Let the operator label findings useful, already known, irrelevant, unsupported,
   or worth testing, with optional reasons. Keep those distinct from later
   adoption or business benefit. Retain a small exploration sample and randomly
   sample rejected candidates for review to expose filtering mistakes.

For the first pilot, let Aside's existing browser execution collect evidence and
use Jev for triage. Jev-driven browser navigation is a separate experiment; do
not make it a prerequisite or replace Aside merely to reproduce a demo.

## Readiness proof and rollout

First run manually on a fixed recent window. Verify the claiming connector is
`mac-studio`, the backend is the local Aside MCP, returned links/excerpts match
observed sources, and the digest separates facts from uncertainty. A successful
command exit or model `DONE` is insufficient proof. A blocked login, unsupported
action, or unavailable MCP must never become a successful empty result.

Exercise Studio-offline, expiry, duplicate-run, partial-search, and low-confidence
cases. Retain rejected candidates and compare the digest with operator review.
Then propose a daily America/Chicago schedule with bounded cost, elapsed time,
and catch-up behavior. Record coverage gaps rather than silently discarding them.
Enabling that recurring schedule is a separate implementation step.

See [DW-14 and the related backlog](../backlog.md). This task adds no always-visible
agent tool and requires no new model vendor or revived OpenRouter/Exa key.
