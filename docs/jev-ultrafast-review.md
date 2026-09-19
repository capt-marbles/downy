# jev-ultrafast: relevance to Downy

Reviewed 2026-09-18. Source review only: no dependencies installed, browser demo
executed, or runtime integration added. Upstream is pinned to
[`1231850a0bf1a0c0341fe408ef1668dbbfdfac46`](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46).

## Assessment

This is a concrete example of Jev selecting the next browser action, with code
executing it. It is relevant to local hands and to the AgentRun article's
separation of decisions from actions. It does not implement learning from
marketing outcomes. Downy's existing Campaign Room review improvements remain
the shorter route to making Jev useful for the LinkedIn draft.

The recommendation is to borrow and test specific mechanisms in a later local
browser pilot, preserving Downy's grants and confirmations. Do not replace the
Workers app or adopt the demo's model providers as part of this review.

## Mechanisms worth borrowing

The model receives a compact page observation and indexed controls. One request
asks for the operation and conditional target choices. Only the chosen
operation's corresponding target is used. Generated text is requested separately
when typing requires it. Choice validation checks IDs, distributions, and their
consistency. This avoids generating selectors or executable code in model output.
See the [model adapter](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py).

Decisions are consumed before execution, and action history is preserved before
the next observation. These are useful defenses against accidental replay when
navigation interrupts a step. See the [agent loop](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py).

The browser layer verifies freshness and checks that targets remain connected,
enabled, visible, and unobscured. It uses code-owned node identities rather than
model-generated selectors. Downy should pair these checks with its existing
operation IDs and uncertain-action reconciliation; freshness alone does not
guarantee exactly-once effects. See the [browser executor](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/browser.py).

The flight example separately checks the requested route, trip type, dates, and
visible results. That distinction is valuable: an executor saying `DONE` is not
proof of a correct result. Make independent completion verification a Downy task
contract rather than relying on every example author to add it. See the
[flight verifier](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/examples/flights.py).

## What Downy would need to add

- **Authority:** choosing an observed control does not authorize its effects.
  Enforce origin/operation grants and existing operator gates in code. A prompt
  saying not to book or post is insufficient.
- **Uncertainty policy:** the reviewed loop records confidence but does not use
  a confidence threshold to stop execution. Downy needs a policy for both the
  operation and its target, plus an explicit fallback. Neither a high probability
  nor a valid schema establishes permission or correctness.
- **Privacy:** the snapshot excludes password, file, and hidden inputs, but
  visible text and ordinary fields can still contain private information. Limit
  and redact observations before sending them to any model. See the
  [snapshot implementation](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/snapshot.js).
- **Runtime adaptation:** the demo uses Python, a local Chrome harness, direct
  TypeSafe credentials, and a configurable text helper. Its example configuration
  includes OpenRouter. Downy should retain `env.AI`, validate against the
  Cloudflare request schema, and reuse an approved text-generation path. Revoked
  OpenRouter/Exa keys are not needed for this design. See the
  [setup documentation](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/README.md).
- **Bounded failure:** step limits and request timeouts are useful but do not
  replace a whole-run deadline. Unknown action outcomes require reconciliation;
  an unavailable evaluator must not cause speculative browser actions.

These are adaptation requirements inferred from source inspection, not a claim
that the upstream demo promises Downy's authorization or operational model.

## How much weight to give the speed claims

The published matched comparison uses three runs per arm on one flight-search
task: median 9.450 seconds versus 7.092 seconds. The measured interval excludes
browser startup, initial navigation/observation, and independent verification.
The reported text-helper cost is not total model cost. This is useful engineering
evidence about reducing browser/model round trips, but too small and narrow to
predict Downy's latency or savings. See the [performance report](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/docs/performance.md).

A Downy pilot should count every attempted run, verify success independently,
measure the full task duration and all inference usage, and compare on fixed
tasks. Reducing tool calls only counts as improvement when the required result
and authorization boundaries are preserved.

## Concrete backlog changes

Added to the [backlog](backlog.md):

- **DW-11, P0:** stop unsupported local-hands actions reporting success. The
  current daemon advertises `browser.automation`, has no browser executor, and
  marks its skeleton result completed. This is an existing correctness defect,
  independent of whether Downy adopts any browser loop.
- **DW-12, P2:** pilot observed-control Jev choices through the existing browser
  action path, with permissions, freshness, uncertainty, and execution bounds.
- **DW-13, P1:** verify completion independently and standardize honest benchmark
  boundaries. Keep task success separate from later business outcomes.

No new agent tool, provider key, package, migration, deployment, or publishing
action is part of this review.
