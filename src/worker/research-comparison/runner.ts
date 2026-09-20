import {
  type ComparisonRun,
  type ComparisonSource,
  type ComparisonDraft,
} from "../../lib/research-comparison";
import { evaluateComparison, fingerprint } from "./evaluate";
import { comparisonMarkdown } from "./report";
import type { JevRunner } from "../jev/client";
type ComparisonIO = {
  save(run: ComparisonRun): Promise<void>;
  write(path: string, value: string): Promise<void>;
  captures(run: ComparisonRun): Promise<ComparisonSource[] | null>;
  draft(
    sources: ComparisonSource[],
  ): Promise<{ draft: ComparisonDraft; generator: string; usage: unknown }>;
  evaluate: JevRunner;
  schedule(id: string, seconds: number): Promise<void>;
  notify(run: ComparisonRun): Promise<void>;
};
export async function advanceComparison(
  run: ComparisonRun,
  io: ComparisonIO,
): Promise<void> {
  if (["complete", "failed"].includes(run.phase)) {
    await io.notify(run);
    return;
  }
  let completedSaved = false;
  try {
    if (run.phase !== "capturing")
      throw new Error(
        "An interrupted model step needs an explicit retry. Previous evidence is retained; it has not been run again.",
      );
    if (Date.now() > run.createdAt + 86400000)
      throw new Error(
        "Studio captures expired after 24 hours. No comparison was generated.",
      );
    const sources = await io.captures(run);
    if (!sources) {
      await io.schedule(run.id, 30);
      return;
    }
    run.sources = sources;
    const base = `workspace/research/comparisons/${run.id}`;
    await io.write(`${base}/sources.json`, JSON.stringify(sources, null, 2));
    run.phase = "drafting";
    run.updatedAt = Date.now();
    await io.save(run);
    // Watchdog marks interrupted work for review. It never silently repeats a
    // paid/subscription model request whose outcome is unknown.
    await io.schedule(run.id, 180);
    const generated = await io.draft(sources);
    run.draft = generated.draft;
    run.generator = generated.generator;
    run.phase = "checking";
    run.updatedAt = Date.now();
    await io.save(run);
    await io.write(`${base}/draft.json`, JSON.stringify(generated, null, 2));
    const evaluation = await evaluateComparison(
      run.draft,
      sources,
      io.evaluate,
    );
    run.checks = evaluation.checks;
    run.error = evaluation.error;
    run.model = evaluation.response?.model ?? null;
    run.auditPath = `${base}/evaluation.json`;
    const audit = {
      runId: run.id,
      sourceRevision: run.sourceRevision,
      evaluatedAt: Date.now(),
      generator: generated.generator,
      generationUsage: generated.usage,
      ...evaluation,
      requestHash: await fingerprint(evaluation.request),
      policyHash: await fingerprint(evaluation.policy),
    };
    await io.write(run.auditPath, JSON.stringify(audit, null, 2));
    // Include passed findings in feedback collection; deterministic hash ranking
    // prevents hand-picking only embarrassing failures. This is not blind labeling.
    const accepted = await Promise.all(
      run.checks
        .filter((c) => c.status === "supported")
        .map(async (c) => ({
          index: c.index,
          rank: await fingerprint({ run: run.id, finding: c.index }),
        })),
    );
    run.sample = [
      ...new Set([
        ...run.checks
          .filter((c) => c.status !== "supported")
          .map((c) => c.index),
        ...accepted
          // eslint-disable-next-line unicorn/no-array-sort -- Local array; ES2022 types lack toSorted.
          .sort((a, b) => a.rank.localeCompare(b.rank))
          .slice(0, 2)
          .map((c) => c.index),
      ]),
    ];
    run.reportPath = `${base}/report.md`;
    await io.write(run.reportPath, comparisonMarkdown(run));
    run.phase = "complete";
    run.updatedAt = Date.now();
    await io.save(run);
    completedSaved = true;
    await io.notify(run);
  } catch {
    if (completedSaved) return; // The scheduled watchdog can retry receipt delivery.
    run.phase = "failed";
    run.updatedAt = Date.now();
    run.error =
      "Comparison stopped. Check Studio capture status or the selected model's login. Interrupted model work is not automatically repeated; use Retry comparison when ready.";
    await io.save(run);
    await io.notify(run);
  }
}
