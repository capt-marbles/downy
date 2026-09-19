import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Layers3, RefreshCw, Sparkles } from "lucide-react";
import { z } from "zod";
import BackLink from "../components/ui/BackLink";
import PageShell from "../components/ui/PageShell";
import StatusDot from "../components/ui/StatusDot";
import ResearchShelf from "../components/research/ResearchShelf";
import {
  RESEARCH_VIEW_LABELS,
  ResearchSnapshotSchema,
  ResearchViewModeSchema,
  type ResearchViewMode,
} from "../lib/research-view";
import { agentFetch } from "../lib/agent-request";

export const Route = createFileRoute("/agent/$slug/research")({
  component: ResearchPage,
});
const ResponseSchema = z.object({
  snapshot: ResearchSnapshotSchema.nullable(),
});

function ResearchPage() {
  const { slug } = Route.useParams();
  const [selectedMode, setMode] = useState<ResearchViewMode | null>(null);
  const client = useQueryClient();
  const queryKey = ["research-view", slug];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await agentFetch(slug, "/api/research-view");
      if (!response.ok)
        throw new Error(
          "Could not load the saved view. Sign in again or open Files.",
        );
      return ResponseSchema.parse(await response.json()).snapshot;
    },
  });
  const mode = selectedMode ?? query.data?.mode ?? "all";
  const compose = useMutation({
    mutationFn: async () => {
      const response = await agentFetch(
        slug,
        `/api/research-view?view=${mode}`,
        { method: "POST" },
      );
      if (!response.ok)
        throw new Error(
          "Could not refresh the view. Your files are still available in Files.",
        );
      return ResponseSchema.parse(await response.json()).snapshot;
    },
    onSuccess: (snapshot) => {
      client.setQueryData(queryKey, snapshot);
    },
  });
  const snapshot = query.data;
  const error = compose.error || query.error;
  const busy = compose.isPending;
  return (
    <PageShell width="wide">
      <BackLink to="/agent/$slug" params={{ slug }} label="chat" />
      <header className="mb-7 mt-2">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
          <Layers3 size={14} />
          Research room{" "}
          <span className="rounded border border-primary/25 px-1.5 py-0.5 text-[10px] tracking-normal">
            PILOT
          </span>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your research, in view.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-base-content/60">
          Saved reports, browser captures, and pilot briefs. Jev arranges the
          view; each document opens directly from your workspace.
        </p>
      </header>
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-base-300 bg-base-200/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Research view"
          className="grid grid-cols-3 gap-1"
        >
          {ResearchViewModeSchema.options.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={busy}
              onClick={() => setMode(value)}
              className={`btn btn-sm min-h-11 px-2 text-[11px] sm:text-xs ${mode === value ? "btn-neutral" : "btn-ghost"}`}
            >
              {RESEARCH_VIEW_LABELS[value]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => compose.mutate()}
          disabled={busy || query.isPending}
          className="btn btn-primary min-h-11 gap-2"
        >
          {busy ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {busy
            ? "Arranging your research…"
            : snapshot
              ? "Refresh with Jev"
              : "Build my view"}
        </button>
      </div>
      <div aria-live="polite" className="mb-5">
        {error && (
          <p role="alert" className="mb-3 text-sm text-error">
            {error.message}
          </p>
        )}
        {query.isPending && (
          <p className="text-sm text-base-content/60">
            Loading your saved view…
          </p>
        )}
        {busy && (
          <p className="text-sm text-base-content/60">
            Checking workspace files and choosing a layout. Your previous view
            stays available.
          </p>
        )}
        {snapshot && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/55">
            <p className="inline-flex items-center gap-2">
              <StatusDot
                tone={
                  snapshot.composition.state === "jev" ? "success" : "neutral"
                }
              />
              {snapshot.records.length} saved documents ·{" "}
              {RESEARCH_VIEW_LABELS[snapshot.mode]}
            </p>
            <span>
              {snapshot.composition.state === "jev"
                ? "Arranged by Jev on Cloudflare"
                : "Standard list"}{" "}
              ·{" "}
              {new Date(snapshot.generatedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
        {snapshot?.composition.reason && (
          <p className="mt-3 rounded-lg bg-warning/10 p-3 text-xs leading-relaxed text-base-content/70">
            {snapshot.composition.reason}
          </p>
        )}
      </div>
      {!snapshot && !query.isPending && !error && (
        <div className="rounded-xl border border-dashed border-base-300 px-6 py-14 text-center">
          <Layers3 className="mx-auto mb-4 text-base-content/30" size={30} />
          <h2 className="font-semibold">Bring your saved work together.</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-base-content/60">
            Choose a view and tap Build my view. This reads existing files and
            saves the layout for your next visit.
          </p>
        </div>
      )}
      {snapshot && (
        <>
          {!snapshot.records.length && (
            <p className="py-12 text-center text-sm text-base-content/60">
              No matching saved documents in this view yet.
            </p>
          )}
          <ResearchShelf slug={slug} snapshot={snapshot} />
          <footer className="mt-7 space-y-3 border-t border-base-300 pt-4 text-xs leading-relaxed text-base-content/55">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                File existence checked{" "}
                {new Date(snapshot.checkedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                . Saved does not mean independently verified.
              </span>
              <a
                href={`/agent/${encodeURIComponent(slug)}/workspace`}
                className="inline-flex min-h-11 items-center gap-1 font-medium"
              >
                All workspace files <ArrowRight size={14} />
              </a>
            </div>
            {snapshot.omitted > 0 && (
              <p>
                Showing matches from the 12 most recently updated research
                documents. {snapshot.omitted} older files are available in
                Files.
              </p>
            )}
            <details>
              <summary className="cursor-pointer py-2">
                How this view was made
              </summary>
              <p className="pt-2">
                json-render 0.21.0 · Cloudflare Workers AI ·{" "}
                {snapshot.composition.models.join(", ") ||
                  "No completed model response"}
                <br />
                {snapshot.composition.calls} completed evaluations ·{" "}
                {snapshot.composition.inputTokens} input tokens ·{" "}
                {(snapshot.composition.elapsedMs / 1000).toFixed(1)} seconds.
                Jev can arrange supplied cards, but cannot change their
                contents, links, or saved status. Reloading this page does not
                run Jev again.
              </p>
            </details>
          </footer>
        </>
      )}
    </PageShell>
  );
}
