import type { ComparisonRun } from "../../lib/research-comparison";
function plainMarkdown(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/[\\`*_{}[\]()#+!|<>]/g, "\\$&");
}
export function comparisonMarkdown(run: ComparisonRun): string {
  return [
    "# Three-source comparison: AI for game development",
    "This is a bounded comparison of three Studio/Aside captures. Jev assesses support in those captures; it does not independently verify the sources. This run does not test CUA browser execution.",
    `Generated with: ${run.generator ?? "unknown"}. Evaluator: ${run.model ?? "unavailable"}.`,
    run.error
      ? `**Review warning:** ${run.error}`
      : "Pilot thresholds are provisional, not calibrated on your research outcomes.",
    "## Findings and evidence",
    ...(run.draft?.findings ?? []).map((finding, index) => {
      const check = run.checks[index];
      return [
        `### ${index + 1}. ${plainMarkdown(finding.claim)}`,
        `**${check?.status ?? "unavailable"}** — ${check?.reason ?? "Not evaluated"}`,
        ...finding.citations.map(
          (c) =>
            `Source ${c.sourceId}: ${run.sources.find((s) => s.id === c.sourceId)?.capturedUrl ?? "Missing source"}\n\n${c.quote
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n")}`,
        ),
        `Support probability: ${check?.supportProbability ?? "unknown"}; native choice confidence: ${check?.supportConfidence ?? "unknown"}; contradiction probability: ${check?.contradictionProbability ?? "unknown"}.`,
        `Relevance score: ${check?.relevanceScore ?? "unknown"} / 2 (0 unrelated, 1 adjacent, 2 direct); native score confidence: ${check?.relevanceConfidence ?? "unknown"}.`,
      ].join("\n\n");
    }),
    "## Coverage and gaps",
    ...run.sources.map(
      (source) =>
        `- ${source.id}: ${source.capturedUrl} · observed ${source.observedAt}${source.truncated ? " · partial capture: missing content may change the assessment" : ""}${run.draft?.findings.some((f) => f.citations.some((c) => c.sourceId === source.id)) ? "" : " · no finding cites this source"}`,
    ),
    "Silence in another source does not establish agreement. Captured page dates are not inferred; observation time is not publication time. Contradiction flags need a scope check. These sources are operator-selected, not an exhaustive or representative sample.",
    "## Review sample",
    `Please review findings ${run.sample.map((i) => i + 1).join(", ") || "none"}, including findings that passed. Corrections are operator feedback, not blinded ground truth. Predictions are retained separately and never rewritten by feedback.`,
    `Evidence record: ${run.auditPath ?? "pending"}`,
  ].join("\n\n");
}
