import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ComparisonRunSchema,
  type ComparisonRun,
} from "../../lib/research-comparison";
import { agentFetch } from "../../lib/agent-request";
import { useCurrentAgentSlug } from "../../lib/agents";
import StatusDot from "../ui/StatusDot";
const Reply = z.object({ run: ComparisonRunSchema.nullable() });
const labels = {
  capturing: "Waiting for three Studio captures",
  drafting: "Writing findings with the selected model",
  checking: "Jev is checking the evidence",
  complete: "Evidence review ready",
  failed: "Comparison stopped",
};
export default function ComparisonPanel({
  ticketId,
  sourceRevision,
}: {
  ticketId: string;
  sourceRevision: string;
}) {
  const slug = useCurrentAgentSlug(),
    client = useQueryClient();
  const key = ["research-comparison", slug, ticketId];
  const endpoint = `/api/research-comparison?ticket=${ticketId}`;
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const response = await agentFetch(slug, endpoint);
      if (!response.ok) throw new Error("Could not load comparison status.");
      return Reply.parse(await response.json()).run;
    },
    refetchInterval: (state) =>
      state.state.data &&
      ["complete", "failed"].includes(state.state.data.phase)
        ? false
        : 5000,
  });
  const start = useMutation({
    mutationFn: async () => {
      const response = await agentFetch(slug, `${endpoint}&op=start`, {
        method: "POST",
      });
      if (!response.ok)
        throw new Error(
          "Could not start. Check your saved sources and try again.",
        );
      client.setQueryData(key, Reply.parse(await response.json()).run);
    },
  });
  const run = query.data;
  const busy = !!run && !["complete", "failed"].includes(run.phase);
  return (
    <section
      className="mt-4 rounded-lg border border-base-300 bg-base-100 p-4"
      data-kind="comparison-review"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <StatusDot
          tone={
            run?.phase === "failed" ? "error" : busy ? "warning" : "neutral"
          }
          pulse={busy}
        />
        Three-source evidence check
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-base-content/65">
        Reads your three URLs with Aside on Mac Studio, writes findings using
        your selected model, then checks their cited evidence with Jev. This
        tests report verification; it does not run CUA.
      </p>
      {!run && !query.isPending && !query.error && (
        <p role="status" className="mt-3 text-sm">
          Sources saved. Tap Start comparison with Studio to begin research.
        </p>
      )}
      {run && (
        <p role="status" className="mt-3 text-sm">
          {labels[run.phase]}
        </p>
      )}
      {run && run.sourceRevision !== sourceRevision && (
        <p className="mt-2 text-xs text-warning">
          This run uses an earlier source selection. Its evidence is preserved.
          Start a new comparison after it finishes to use your updated URLs.
        </p>
      )}
      {(!run ||
        run.phase === "failed" ||
        (run.phase === "complete" &&
          run.sourceRevision !== sourceRevision)) && (
        <button
          className="btn btn-primary btn-sm mt-3 min-h-11 w-full"
          type="button"
          disabled={busy || start.isPending || query.isPending || !!query.error}
          onClick={() => start.mutate()}
        >
          {start.isPending
            ? "Starting…"
            : run?.phase === "failed"
              ? "Retry comparison"
              : "Start comparison with Studio"}
        </button>
      )}
      {(start.error || query.error || run?.error) && (
        <p role="alert" className="mt-2 text-xs text-warning">
          {start.error?.message || query.error?.message || run?.error}
        </p>
      )}
      {run?.phase === "complete" && (
        <>
          <p className="mt-2 text-xs text-base-content/65">
            Source-support checks are provisional. They do not establish
            independent truth or predict engagement.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a
              className="link"
              href={`/agent/${encodeURIComponent(slug)}/workspace/${run.reportPath}`}
            >
              Open report
            </a>
            <a
              className="link"
              href={`/agent/${encodeURIComponent(slug)}/workspace/${run.auditPath}`}
            >
              Evidence record
            </a>
          </div>
          {run.draft?.findings.map((finding, i) => (
            <details
              key={i}
              className="mt-3 rounded border border-base-300 p-3"
            >
              <summary className="cursor-pointer text-sm leading-relaxed">
                {i + 1}. {finding.claim}{" "}
                <span className="text-xs text-base-content/55">
                  · {run.checks[i]?.status}
                  {run.sample.includes(i) ? " · review sample" : ""}
                </span>
              </summary>
              <p className="my-2 text-xs">{run.checks[i]?.reason}</p>
              {finding.citations.map((citation, j) => (
                <blockquote
                  key={j}
                  className="my-3 border-l-2 border-base-300 pl-3 text-xs leading-relaxed"
                >
                  <p className="whitespace-pre-wrap">{citation.quote}</p>
                  <a
                    className="link"
                    target="_blank"
                    rel="noreferrer"
                    href={
                      run.sources.find((s) => s.id === citation.sourceId)
                        ?.capturedUrl
                    }
                  >
                    Open {citation.sourceId}
                  </a>
                </blockquote>
              ))}
              <p className="text-xs text-base-content/60">
                Support probability{" "}
                {run.checks[i]?.supportProbability ?? "unknown"}; native
                confidence {run.checks[i]?.supportConfidence ?? "unknown"}.
                Contradiction probability{" "}
                {run.checks[i]?.contradictionProbability ?? "unknown"}.
                Relevance {run.checks[i]?.relevanceScore ?? "unknown"}/2.
              </p>
              <FindingFeedback run={run} index={i} slug={slug} />
            </details>
          ))}
          <p className="mt-3 text-xs text-base-content/60">
            Please also review the sampled findings that passed. Your feedback
            is stored separately; this is not blind labeling or automatic model
            training.
          </p>
        </>
      )}
    </section>
  );
}
function FindingFeedback({
  run,
  index,
  slug,
}: {
  run: ComparisonRun;
  index: number;
  slug: string;
}) {
  const client = useQueryClient();
  const [id, setId] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const note = form.get("note"),
        verdict = form.get("verdict");
      const response = await agentFetch(
        slug,
        `/api/research-comparison?ticket=${run.ticketId}&op=feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            runId: run.id,
            findingIndex: index,
            verdict,
            note: typeof note === "string" ? note : "",
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          "Could not save feedback. Reload if this comparison has changed.",
        );
      client.setQueryData(
        ["research-comparison", slug, run.ticketId],
        Reply.parse(await response.json()).run,
      );
      setId(crypto.randomUUID());
    },
  });
  const previous = run.feedback
    .filter((item) => item.findingIndex === index)
    .at(-1);
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(new FormData(event.currentTarget));
      }}
    >
      <label className="grid gap-1 text-xs">
        Your evidence assessment
        <select
          name="verdict"
          className="select select-bordered min-h-11 w-full"
          defaultValue="unclear"
        >
          <option value="unclear">Unclear / needs more evidence</option>
          <option value="supported">Supported by the cited evidence</option>
          <option value="unsupported">
            Not supported by the cited evidence
          </option>
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        Correction or missing evidence
        <textarea
          name="note"
          maxLength={1000}
          className="textarea textarea-bordered w-full"
        />
      </label>
      <button
        disabled={save.isPending || run.feedback.length >= 20}
        type="submit"
        className="btn btn-outline btn-sm min-h-11"
      >
        {save.isPending ? "Saving…" : "Save assessment"}
      </button>
      {previous && (
        <p className="text-xs" role="status">
          Saved assessment: {previous.verdict}. Original Jev result retained.
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-xs text-error">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
