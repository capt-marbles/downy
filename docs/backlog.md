# Downy backlog: repeatable work and outcome feedback

Status: proposed work, not implemented or approved for production rollout.
Reviewed 2026-09-18 against source commit `410c988`.

Source: the operator supplied the full article **AgentRun: a harness for
repetitive knowledge work**, attributed to Grep.ai. Its canonical URL was not
provided. This assessment uses that text; its performance and deployment claims
have not been independently verified.

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

## Suggested delivery order

1. **Make the current loop trustworthy:** DW-01 and DW-02, with the narrow
   decision view from DW-10. The 0.61 package example should become explainable
   or explicitly uncertain, without tuning the system merely to pass it.
2. **Establish evidence for learning:** DW-03 and DW-04, plus DW-05. Start with
   manual observations so platform API availability does not block the design.
3. **Reduce recurring work:** DW-06 and DW-07. Complete DW-08 before extending
   externally acting automation. Prove savings on Downy's own workload.
4. **Test controlled adaptation:** DW-09 only after the evaluation and rollback
   mechanisms exist. Never trade away operator gates to improve completion rate.

This backlog does not authorize buying AgentRun, adding a model vendor, posting
the current LinkedIn draft, changing live thresholds, or automatically training
Jev. Learning initially means preserving evidence, supplying relevant history,
and testing versioned changes to the system's decisions.
