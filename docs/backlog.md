# Downy backlog: repeatable work and outcome feedback

Status: proposed work, not implemented or approved for production rollout.
Reviewed 2026-09-18 against source commit `410c988`.

Source: the operator supplied the full article **AgentRun: a harness for
repetitive knowledge work**, attributed to Grep.ai. Its canonical URL was not
provided. This assessment uses that text; its performance and deployment claims
have not been independently verified.

Additional source review: [browser-use/jev-ultrafast](jev-ultrafast-review.md),
pinned to upstream commit `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`.
Its browser execution pattern informs DW-11 through DW-13; it does not supply
the outcome-learning system described below.

## Assessment

The strongest fit is the separation of evidence gathering, bounded judgment,
deterministic control flow, and authorized action. Downy already has parts of
this architecture: typed Campaign Room artifacts, a generic stage engine,
separate gate decisions, Jev evaluation, and a coded MCP retry ladder. Extend
those pieces before considering another harness or workflow language.

There are two different improvement loops:

1. **Execution improvement:** deliver the same acceptable work with less cost,
   latency, unnecessary research, or operator effort. Traces and replay help.
2. **Outcome improvement:** produce better real-world results, such as relevant
   conversations from content. This needs predefined outcomes, observations,
   exposure data, comparisons, and prospective experiments.

The article is strongest on the first loop. It does not establish that optimizing
an internal judge or reducing tool calls will improve marketing outcomes. Downy
needs both loops and separate measures of success for each.

The operator's proposed task category is **tasks that improve with outcome
feedback**. Make feedback an opt-in task contract; do not require every one-off
task to become an experiment. An SOP is useful only when the work repeats and
has sufficiently stable inputs and evaluation criteria.

## What to adopt, test, and defer

| Article idea                                                           | Downy relevance                                                                                | Disposition                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Typed judgments, code-controlled consequences                          | Already present in Jev gating and MCP triage                                                   | Improve evidence, question specificity, and policy semantics             |
| Inspectable, replayable decisions                                      | Evaluation rows exist, but inputs and full responses are not retained there                    | Foundation work                                                          |
| Field-level claim verification                                         | Current editorial check reads the review artifact, not the underlying draft and cited evidence | High-value addition                                                      |
| Traces and short reusable lessons                                      | Useful for repeated research and draft preparation                                             | Retain receipts and testable lessons, not authoritative self-assessments |
| Tool discovery with per-run grants                                     | Fits the goal of reducing model context                                                        | Scope existing tools and enforce grants at execution                     |
| Code for polling, retries, and mechanical checks                       | MCP triage already demonstrates this shape                                                     | Pilot a small reusable execution path                                    |
| Workflow learning and gradual adoption                                 | Potentially useful after evidence and evaluation exist                                         | Later, reviewed candidate changes and limited rollout                    |
| New Pi harness, AgentRun DSL, or named research/report/operator agents | Not necessary to gain the above benefits                                                       | No adoption or framework rewrite proposed                                |
| AML early stopping                                                     | Valid only when remaining evidence cannot change the permitted decision                        | Do not transfer this shortcut to broad GTM discovery without proof       |

The article's savings, latency, accuracy, and fallback rates are author-reported
results from another workload. They are hypotheses for Downy to test, not our
targets or expected ROI. The evaluator's agreement is not automatically ground
truth. Nor does a claimed calibration property establish calibration on Downy's
audience, rubric, or changing model versions.

Two technical distinctions matter:

- Cloudflare's Jev Boolean response is `noul`, a probability with no separate
  native confidence field. Choice and score answers expose additional fields.
  Downy's `max(p, 1-p)` is a derived policy value, not independent evidence of
  correctness. A normalized quality score is not an engagement probability.
  See the [Cloudflare Jev schema and examples](https://developers.cloudflare.com/ai/models/typesafe/jev/).
- Changing downstream deterministic rules can replay saved answers without
  calling a model. Changing a question, its evidence, or the model requires new
  inference on the frozen cases. Old answers cannot validate a rewritten rubric.

The decision/action separation also aligns with
[12-Factor Agents](https://github.com/humanlayer/12-factor-agents), particularly
owning control flow and using small, focused components. This is an architectural
principle, not a requirement to install that project's tooling.

## Current evidence and constraints

- [Criteria evaluation](../src/worker/campaign-room/criteria.ts) combines stage
  instructions with one artifact. Multi-part prose criteria yield one probability
  per entry. The broad publish-readiness check does not explain which part failed.
- [Advancement](../src/worker/campaign-room/advance.ts) records machine evidence
  separately from gates and fails open with a warning on evaluator outages.
- [Evaluation storage](../migrations/0013_workflow_criteria_evaluations.sql) keeps
  criterion text, scalar results, model version, and truncation. It does not keep
  the exact request, answer distributions, policy version, or artifact revision.
- [Artifact writes](../src/worker/campaign-room/artifacts.ts) replace the current
  JSON file. Their event entries identify a path and time, not the previous bytes.
- [Workflow schemas](../src/worker/buildroom/workflows.ts) include a template
  version, but runs do not pin an immutable definition and policy snapshot.
- [MCP triage](../src/worker/agent/mcp-triage.ts) already separates classification
  from a bounded, deterministic retry policy. Reuse that pattern.
- [Tool assembly](../src/worker/agent/DownyAgent.ts) and
  [tool wrappers](../src/worker/agent/tool-registry.ts) expose connected MCP
  descriptors. Discovery alone does not establish per-stage execution grants.
- The live LinkedIn demonstration caught a missing CTA and missing variants.
  The editorial check subsequently passed at 0.98, while package readiness was
  blocked at 0.61 without a specific defect. These are demonstration cases, not a
  calibration dataset; the post has no observed audience outcome.

All work below preserves Campaign Room's operator gates and the generic workflow
engine. No resurrection of the engineering lifecycle, new always-visible agent
tools, provider swap, new vendor dependency, or changes to the four templates and
schedule presets are authorized by this backlog. Proposed rubric revisions must
be explicit, versioned changes reviewed during implementation. Existing
credential isolation and secret redaction apply to every new trace and dataset.

## Prioritized work

### DW-01 — P0: Make Jev failures specific and policy decisions unambiguous

**Problem:** a probability for “ready for posting” cannot identify the next edit.
Current policy can block a Boolean result of 0.61 because it is below the 0.7
pass threshold while its derived certainty exceeds 0.6. That is a policy result,
not an explanation or a confident assertion that the content is false.

**Work:** propose versioned, atomic checks. Use code for required fields, file
existence, format, and known permissions. Use Jev for bounded semantic questions
with the relevant draft, brief, claim, cited excerpt, and policy exceptions.
Distinguish content readiness from whether the operator has authorized posting.
An editorial review's self-description is not evidence that its draft is sound.

**Acceptance:**

- A failing check returns a stable criterion ID, exact criterion, observed
  probability, evidence references, and a concrete field to review. Unknown or
  missing evidence is explicit; never fabricate a rationale from a low score.
- Document and test pass, fail, and uncertainty regions, including 0.61, 0.66,
  missing evidence, and contradictory evidence. Choose boundaries from labeled
  cases; do not lower a threshold merely to make the demonstration pass.
- Show native probability, native confidence when supplied, derived certainty,
  and normalized quality score as different quantities in storage and UI.
- Retrying returns only failed checks to the drafting session, with a fixed
  revision budget. Exhaustion escalates. Unsupported required claims remain
  visible as unresolved; any removal is tracked in the artifact diff.
- Passing checks never grant operator approval. Draft-evaluator outages retain
  the existing explicit fail-open behavior and independent action gates.

**Start:** current LinkedIn cases plus synthetic missing, conflicting, and
unsupported evidence. Synthetic examples test behavior, not business success.

### DW-02 — P0: Persist immutable decision inputs and a run ledger

**Problem:** a saved probability cannot explain or replay a decision when the
artifact and template can change afterward.

**Work:** attach an evaluation ID to immutable artifact and evidence revisions;
retain the exact sanitized Jev request and validated response. Fingerprint the
rubric, deterministic policy, workflow definition, and any relevant skill/tool
version. Keep compact indexes and run costs in D1, larger snapshots in the
existing R2-backed workspace.

**Acceptance:**

- A decision opens its actual evaluated input, truncation details, complete
  answer distributions/score legend, model version, thresholds, and resulting
  action. Hashes resolve to retained content; hashes alone are insufficient.
- Rewriting an artifact cannot change a historical decision's evidence.
  Approval is linked to the artifact/evidence revision reviewed; a material edit
  cannot inherit stale approval merely because its timestamp is later.
- Record node latency, tool calls, errors, retries, escalations, token usage,
  and cost with a price/version source. Include research, judging, reporting,
  tuning, and fallbacks; mark unavailable costs rather than inventing them.
- Server-generated timestamps, append-only corrections, and correlation IDs
  allow a run to be reconstructed without private chain-of-thought. Concise
  decision summaries and execution receipts suffice.
- Credential redaction tests cover snapshots, datasets, summaries, and exports;
  define retention and deletion rules for sensitive evidence.

### DW-03 — P1: Define an outcome-feedback contract for eligible tasks

**Depends on:** DW-02 for traceable task and artifact identity.

**Work:** separate execution completion, artifact quality, business outcome, and
operational cost. Before action, save an operator-reviewed outcome definition:
population, metric and denominator, observation windows, source, baseline,
success rule, guardrails, attribution limits, minimum evidence requirements,
prediction, and planned update/experiment rule.

**Acceptance:**

- The initial LinkedIn contract distinguishes relevant conversations from likes
  and impressions. Define “relevant,” how a conversation is attributed, and what
  cannot be observed. Observation windows such as 72 hours/seven days are a
  proposed choice to lock before posting, not a universal success standard.
- Store `not_due`, `observed`, `missing`, and `insufficient_exposure` distinctly.
  Zero is a valid measured value, never a substitute for absent access or data.
- Lock definitions and predictions before exposure. Amendments create new
  versions and preserve the original evaluation; they cannot rewrite success.
- A completed draft with no publication receipt has no LinkedIn outcome yet.
  Do not infer unsuccessful posting from missing engagement data.

### DW-04 — P1: Collect outcome evidence without selecting only convenient cases

**Depends on:** DW-02 and DW-03.

**Work:** start with a REST/UI observation form and validated imports; add
authorized read-only platform collection only where API access permits it.
Store raw observations separately from model interpretations. Add no agent tool.

**Acceptance:**

- Register all eligible attempts before outcomes arrive. Track exact published
  revision, post ID, timestamp, account/audience context, exposure, edits,
  intervention/selection policy, and observation provenance.
- Fixed-window collectors cover successes, failures, and missing observations;
  deduplicate repeated imports and preserve corrections and late arrivals.
- Use consistent exposure definitions and compare like observation windows.
  Account for audience differences, paid boosts, topic, timing, and changed copy;
  do not present an uncontrolled comparison as a causal result.
- Keep prediction labels hidden from human outcome labeling where practical.
  If Jev filters which candidates are published, retain rejected candidates and
  explicitly mark their outcomes unknown. Evaluate selection bias through
  reviewed samples or approved experiments, never publish rejected work silently.
- Treat imported comments and research text as data, not instructions. Keep
  permissions and personal data boundaries separate from outcome optimization.

### DW-05 — P1: Evaluate calibration and replay candidate policies

**Depends on:** DW-01 and DW-02; DW-03/04 for business-outcome evaluation.

**Work:** build a small, labeled regression corpus and separate development and
held-out sets. Labels need independent evidence or human adjudication, with
disagreement retained. Reserve future outcomes for testing changes to marketing
predictions; synthetic fixtures cannot establish effectiveness.

**Acceptance:**

- Freeze inputs to compare a question/model change; freeze model answers to
  compare code/threshold changes. Replay mode cannot invoke external writes.
  Changed questions require fresh inference, not reinterpretation of old answers.
- Report false blocks, missed failures, uncertainty/escalation rates, cost, and
  latency. For actual outcome predictions, report probability reliability and
  error (for example Brier score), sample counts, and uncertainty by task type.
- Prevent related revisions/campaigns from leaking across train/development and
  held-out sets. Limit repeated tuning against the held-out set; use prospective
  evaluation when changing behavior. Record every candidate tried.
- Predefine promotion rules: acceptable quality and safety first, then total
  cost/latency, with enough data to distinguish improvement from noise. A
  development-set win or the same model agreeing with itself is insufficient.
- Produce a versioned comparison report naming changed cases and why the coded
  decision changed. Make model upgrades and rollback independently reviewable.

### DW-06 — P1: Move repeated mechanical steps out of chat turns

**Depends on:** DW-02 for baseline measurement; DW-05 before broad rollout.

**Work:** pilot a bounded server-side sequence using existing workflow services:
schema checks, explicit calls, polls, batched typed judgments, and escalation.
Keep agents for research, writing, and unresolved judgments. Extend the existing
engine; do not start by designing twelve node types or a new DSL.

**Acceptance:**

- Every step declares typed inputs/outputs, tool grants, deadlines, retry bounds,
  and cost limits. Poll status with code, not recurring model turns; waiting must
  yield durably using suitable existing Cloudflare execution primitives.
- Batch independent Jev questions and bound fan-out/concurrency. Preserve source
  IDs and question mappings. Mechanical missing-field checks spend no model call.
- Save checkpoints and resume after interruption. An early stop records skipped
  work and the policy reason; use it only when remaining evidence cannot change
  the permitted result. Broad discovery tasks need explicit coverage goals.
- Compare complete-run cost and results with the current path on the same frozen
  inputs, including fallback cost. Avoid vendor/model swaps in this pilot.

**First pilot:** a Campaign Room review pass over an existing evidence bundle:
deterministic completeness checks, semantic claim checks, a bounded drafting
revision, and the existing gate. No new connector is required to test this path.

### DW-07 — P1: Scope tools and permissions to the current job

**Work:** supply a small tool set for each task/stage; discover additional
capabilities only when needed. Apply the same grants at execution, including
child-agent RPC and MCP wrappers. Role separation does not require resurrecting
Buildroom roles or creating permanent agents for each function.

**Acceptance:**

- Research receives approved read capabilities; report rendering receives the
  frozen decision record and cannot change the verdict or introduce claims.
  External actions require their existing operator authorization.
- UI-hidden or undiscovered tools are also denied at execution when outside the
  grant. Discovery cannot elevate permissions, and child agents cannot inherit
  broader capabilities than the job allows.
- Measure tool-definition count and prompt tokens before/after against actual
  runtime inventories, without assuming the old “26 tools” estimate is current.
- Prefer existing discovery paths and scoped descriptors to adding permanent
  top-level agent tools. Keep credentials outside all model inputs.

### DW-08 — P1: Reconcile uncertain external actions before retrying

**Work:** define operation IDs, idempotency where supported, and states that
distinguish “not attempted,” “confirmed,” “failed,” and “outcome unknown.” This
complements local-hands claim arbitration; one successful claim alone does not
prove an external action happened exactly once.

**Acceptance:**

- A timeout after submission or a connector crash cannot cause automatic resend,
  repost, or re-upload. Reconcile using provider receipts or operator review.
- Bind approval to exact target and payload revision. Changed content, destination,
  or permission requires the appropriate new decision.
- Tests cover loss of the completion acknowledgment, duplicate delivery, worker
  restart, and connector sleep. Queue UI makes unknown outcomes visible.
- No new publish/send integration is implied; implement the contract before
  enabling any such action, and apply relevant parts to existing file transfers.

### DW-09 — P2: Turn repeated lessons into reviewed workflow candidates

**Depends on:** DW-02, DW-05, DW-06, and DW-07; DW-08 for any external actions.

**Work:** allow opt-in learning runs to propose one to three sentence lessons
with supporting run IDs, scope, counterexamples, and expiry/revalidation needs.
Use repeated evidence to propose a workflow or instruction diff; the author is
not its own evaluator or deployment authority.

**Acceptance:**

- A lesson is a hypothesis until tested. One successful shortcut cannot become
  a global rule or silently change a gate, outcome metric, or tool permission.
- Candidate changes are structurally validated, evaluated on held-out cases,
  operator-reviewed, and introduced to a bounded subset with explicit fallback
  and rollback triggers. Record the routing/selection policy to assess bias.
- Calculate break-even using authoring, evaluation, maintenance, observation,
  and fallback costs. A rarely repeated task may remain on the general agent.
- Start with safe configuration/instruction changes. Arbitrary model-written
  executable code and autonomous production promotion are out of this pilot.

### DW-10 — P1: Make decisions and feedback understandable in the UI

**Depends on:** DW-01/02 initially, then DW-03/04/05.

**Work:** extend existing Campaign Room/settings/workspace UI primitives with a
run review view. Avoid another layout system or a stream of raw tool JSON.

**Acceptance:**

- Show what was produced, the specific failed checks, evidence links, revisions,
  applicable policy, remaining gate, and next valid action. Clearly label agent
  review versus operator approval and evaluator availability versus readiness.
- Display artifact completeness, semantic assessment, predicted outcome, observed
  outcome, and cost separately. A 98% completeness result must not look like a
  98% chance of engagement; quality scores retain their named scale.
- Give operators a way to mark an incorrect judgment with evidence. Keep that
  correction distinct from ground truth, training data, and authorization.
- Show which observations are immature or missing, and why an experiment or
  policy proposal is not yet supported by enough evidence.

### DW-11 — P0: Stop reporting unsupported connector actions as completed

**Evidence:** `scripts/downy-hands.mjs` advertises `browser.automation`, but
`executeAction` has no browser executor. Unsupported kinds return a skeleton
result, which `handleClaimedAction` submits with status `completed`.

**Acceptance:**

- Advertise only capabilities backed by enabled executors. A capability shared
  by multiple kinds must not imply that all those kinds are implemented; enforce
  kind support during routing or reject unsupported kinds explicitly.
- An unsupported action returns an actionable failure, never a success receipt.
  Report missing configuration separately from a failed external operation.
- Tests cover an unsupported browser action, disabled optional executors, and
  successful supported actions. Queue UI must not imply the browser work happened.

### DW-12 — P2: Pilot a bounded Jev browser executor on local hands

**Depends on:** DW-11, DW-07, DW-08, and DW-13; DW-02/05 for measurement.

**Work:** adapt the observed-control choice pattern from jev-ultrafast to the
existing browser action path. Start on a controlled search/filter fixture, then
one approved public research site. No posting, purchasing, credential entry, or
new always-visible tool. Keep the browser on the selected connector and Jev on
Downy's existing Workers AI binding; do not adopt the demo's vendor credentials.

**Acceptance:**

- Build operation-compatible choices from observed controls. Batch the operation
  and conditional target questions in one Jev request; execute only the selected
  operation's target. Reject unknown IDs and malformed probability distributions.
  Adapt and test against Cloudflare's schema and response wrapper.
- Code enforces allowed origins and operations. An observed button is not
  permission to click it. Treat page instructions as untrusted; restrict and
  redact transmitted observations, including URLs and ordinary field values.
  Excluding password inputs alone does not protect authenticated page content.
- Require an explicit policy for uncertain operation or target choices. A Jev
  error or uncertainty stops automatic action or escalates; the draft evaluator's
  fail-open policy does not authorize browser mutations.
- Revalidate page and target identity immediately before execution, including
  after text generation. Consume each decision once before mutation. Preserve
  the action receipt before observing again; unknown outcomes follow DW-08.
- Use an existing approved text model only when a field needs generated text.
  Reuse generated text only when the complete relevant context is unchanged.
- Bound total elapsed time, actions, decisions, retries, and observation size.
  Detect unsupported frames, controls, and navigation instead of guessing.
- Test stale targets, covered/disabled controls, mismatched operation/target,
  interrupted actions, low confidence, model outages, and denied destinations.
  Compare verified success and full-run cost/latency, counting failed attempts.

### DW-13 — P1: Verify completion independently of the executor's claim

**Depends on:** DW-02; complements DW-03 outcome definitions and DW-08 receipts.

**Work:** define a task-specific completion contract before execution. Keep
executor completion, independently verified task completion, and later business
outcomes as separate records. A model choosing `DONE` is a claim to verify.

**Acceptance:**

- Use fresh observable state and deterministic checks wherever possible: expected
  destination, query parameters, selected filters, returned records, or a provider
  receipt. Record verifier version, evidence, time, and explicit unknown results.
- A browser search that returns the wrong route/date/filter fails verification
  even if the agent says it succeeded. Fixture tests include plausible wrong
  results, stale evidence, missing receipts, and a verifier outage.
- Semantic checks retain their model provenance and uncertainty; the executing
  model agreeing with itself is not independent ground truth.
- Benchmarks include startup, observation, inference, retries, and verification
  in end-to-end totals, with component timings separately available. Record all
  attempts and all model usage; a text helper's bill is not the total run cost.
- Keep publishing approval separate. Verified task completion does not establish
  audience engagement, qualified leads, or permission for the next action.

### DW-14 — P1: Pilot AI-for-game-development research on X using Studio's Aside

**Operator preference:** use the local Aside browser MCP on **mac-studio** for
this pilot. Keep the authenticated browser session on that machine. Do not route
to the laptop or substitute another browser/provider silently.

**Additional candidates:** the operator nominated Taskfuel and Treg. Their live
catalogs expose X search endpoints; compare explicit API collection branches
against the Studio/Aside branch on fixed queries, with source provenance,
deduplication, freshness checks, and a predefined spend budget. The linked plan
records endpoint discovery and current gaps. Discovery did not execute searches
or establish Downy runtime connectivity.

**Plan:** [X research pilot](pilots/x-ai-game-development.md). Use the existing
`x.research` local-hands action with `targetConnectorId: "mac-studio"`. The
generic request supports routing; the dedicated Grok shortcut currently does not
expose that field. No new top-level agent tool is needed.

**Acceptance:** prove one live, bounded, read-only collection through Studio's
Aside MCP; retain source receipts and coverage limits; run Jev triage and verify
the digest's claims; capture operator feedback and a sample of rejected items.
Prove offline Studio and expired-task behavior before enabling recurrence.

This pilot does not depend on DW-12's custom browser executor. Use the existing
Aside interface first. DW-11's truthful completion behavior and the applicable
DW-13 verification checks are prerequisites for calling the pilot successful.

### DW-15 — P1: Make voice a usable phone and desktop interaction channel

**Implementation:** the GPT-Live WebRTC call preview is now implemented; see
[voice calls](voice.md) for setup, limits, and the live acceptance checklist.
It includes Start a call, mute/end, captions, read-only workspace lookups through
the existing agent, and durable session cleanup. Automated provider/browser tests
do not establish live readiness. OpenAI secret provisioning, deployment, actual
account access, and desktop/iPhone call acceptance remain operator rollout steps.

**Dictation baseline:** [InputBox](../src/components/chat/InputBox.tsx) already
records audio and inserts editable transcriptions into the composer. The
[/api/transcribe handler](../src/worker/handlers/transcribe.ts) uses
`@cf/openai/whisper-large-v3-turbo` through `env.AI`. This is recorded dictation,
not a full duplex conversation. Live iPhone behavior has not been verified here.

**Operator priority:** as close to real-time conversation as possible; either
OpenAI voice family is acceptable. Prioritize a full-duplex voice pilot rather
than making separate dictation/read-aloud improvements prerequisites. Retain
existing dictation/text as fallback. Keep the existing agent, tools, transcript,
credential cards, and approval flow shared between text and voice.

**Preferred pilot:** GPT-Live 1 over browser WebRTC, with client delegation to
the existing Downy backend. It supports listening while speaking and conversation
during backend work. This is an architectural fit, not a measured latency win
over Realtime. The latter remains a comparison candidate if the pilot is poor.
See [OpenAI's voice architecture comparison](https://developers.openai.com/api/docs/guides/voice-agents)
and [client delegation](https://developers.openai.com/api/docs/guides/live-delegation).

Keep media between the browser and OpenAI; Cloudflare handles authenticated
session setup, backend work, and task state. Keep project credentials server-side.
An interruption updates or cancels work according to application state; it must
not enqueue the same action again. Delegation events contain metadata, so assemble
requests from transcript context and verified task state rather than treating an
event as a complete task. Preserve delegation IDs when returning results.

Start with a short spoken discussion of an existing X research digest, including
follow-up questions, interruptions, and corrections. Validate actual account
access, iPhone playback, useful-answer latency, and session lifecycle before
enabling new tasks by voice. No paid session has been started by this planning
change. GPT-Live's published rate is $0.05 per session minute, billed per second,
plus backend costs; recheck before implementation. See
[model pricing](https://developers.openai.com/api/docs/models/gpt-live-1).

**Cloudflare candidate:** the beta `@cloudflare/voice` SDK offers voice/input
mixins and React hooks over WebSocket. Its Workers AI adapters include Nova-3
for transcription, Flux for conversational input, and Aura for speech output,
using the AI binding. Evaluate compatibility with Downy's existing Think class
and package versions before choosing an integration shape. See
[Cloudflare voice documentation](https://developers.cloudflare.com/agents/communication-channels/voice/).

**Optional local candidate:** assuming the operator means
[jamiepine/voicebox](https://github.com/jamiepine/voicebox), investigate it for
Studio-based transcription and custom spoken output. Its MCP `speak` path plays
on the host machine, so iPhone playback needs audio delivery to Downy's client;
connecting MCP alone is insufficient. Disable personality rewriting when reading
canonical replies so speech does not change their meaning. See
[Voicebox MCP](https://docs.voicebox.sh/overview/mcp-server).

Voicebox's documented remote API lacks authentication. Any remote integration
must use a protected bridge, not expose the raw service. Studio sleep must leave
text available and show voice unavailability; any cloud fallback must be explicit.
See [remote-mode documentation](https://docs.voicebox.sh/overview/remote-mode).
The phone's interactive voice path must not depend on Studio being awake. This
backlog does not select or install Voicebox; Cloudflare audio remains an alternative
to the preferred OpenAI conversation pilot.

**Acceptance:**

- Dictation has clear recording/transcribing/error states, cancel, duration and
  upload limits, and editable text before submission. Stop mic tracks on cancel,
  navigation, and failure. Silence must not silently submit an invented command.
- Read-aloud has play/stop controls and plays on the user's active device. Keep
  full text/source links visible; distinguish a spoken summary from a verbatim
  reading. Do not read credentials or reinterpret confirmation cards.
- Conversational mode has explicit start/end, visible listening/thinking/speaking
  states, interruption, and text fallback. Avoid duplicate turns after reconnect.
  Stopping speech cannot imply rollback of a tool action already submitted.
- Voice uses the same operator gates and out-of-band credential entry as chat.
  Audio goes only to the selected speech/voice provider, not into tool arguments
  or the backend text agent's context. Define retention explicitly, with no
  Downy-persisted recordings by default. UI audio plumbing adds no agent tools.
- Test iPhone Safari and home-screen mode behind Cloudflare Access, permission
  denial, playback activation, headphones, interruptions, background/resume,
  session expiry, network loss, and Studio offline where applicable.
- Measure transcription accuracy on game-development names, end-to-end response
  latency, and total audio/model/runtime cost. Verify live rather than infer
  readiness from SDK examples. No claim of background or lock-screen listening
  without device evidence.
- Measure median and p95 audible useful-answer latency separately from connection
  startup, acknowledgments, backend/tool time, and interruption-to-silence time.
  Test pauses and mid-sentence corrections without manual stop/send between turns.
  Short factual answers can use supplied context; tasks requiring current state
  must delegate. Never announce completion before a verified backend receipt.
- End the provider session on explicit hang-up and enforce an idle timeout and
  duration cap. Reconcile usage on disconnect; a lost phone connection must not
  leave an unbounded paid session or silently duplicate backend work.

## Suggested delivery order

1. **Make the current loop trustworthy:** DW-01 and DW-02, with the narrow
   decision view from DW-10. The 0.61 package example should become explainable
   or explicitly uncertain, without tuning the system merely to pass it. Fix
   DW-11 before further connector tests so unsupported work cannot look successful.
2. **Establish evidence for learning:** DW-03 and DW-04, plus DW-05. Start with
   manual observations so platform API availability does not block the design.
3. **Reduce recurring work:** DW-06 and DW-07. Complete DW-08 before extending
   externally acting automation. Add DW-13 completion contracts and prove savings
   on Downy's own workload. DW-12 is an optional later browser pilot, not a
   prerequisite for improving the current LinkedIn draft workflow.
4. **Test controlled adaptation:** DW-09 only after the evaluation and rollback
   mechanisms exist. Never trade away operator gates to improve completion rate.

This backlog does not authorize buying AgentRun, adding a model vendor, posting
the current LinkedIn draft, changing live thresholds, or automatically training
Jev. Learning initially means preserving evidence, supplying relevant history,
and testing versioned changes to the system's decisions.
