# Pilot: AI developments for game development from X

Status: selected pilot candidate, recorded 2026-09-18. The operator specified
their local Aside browser MCP on the Mac Studio. The live MCP connection and
adapter have not been verified by this planning change; no schedule is enabled.

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
  not just in the research prompt. No laptop or alternate-provider fallback.
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
