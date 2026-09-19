import { agentFetch } from "../../lib/agent-request";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  LocalHandsActionSchema,
  LocalHandsConnectorSchema,
} from "../../worker/local-hands/types";
import { browserResearchPath } from "../../lib/browser-research";
import StatusDot from "../ui/StatusDot";

const SnapshotSchema = z.object({
  actions: z.array(LocalHandsActionSchema),
  connectors: z.array(LocalHandsConnectorSchema),
});

export default function BrowserResearchPanel({ slug }: { slug: string }) {
  const [mode, setMode] = useState("x.research");
  const [query, setQuery] = useState("");
  const client = useQueryClient();
  const queryKey = ["browser-research", slug];
  const snapshot = useQuery({
    queryKey,
    refetchInterval: 5_000,
    queryFn: async () => {
      const response = await agentFetch(
        slug,
        "/api/local-hands?includeCompleted=true",
      );
      if (!response.ok)
        throw new Error("Could not check Studio. Refresh after signing in.");
      return SnapshotSchema.parse(await response.json());
    },
  });
  const studio = snapshot.data?.connectors.find(
    (connector) => connector.id === "mac-studio",
  );
  const online =
    studio?.status === "online" && studio.capabilities.includes("x.research");
  const actions =
    snapshot.data?.actions
      .filter(
        (action) => action.kind === "browser" || action.kind === "x.research",
      )
      .slice(0, 5) ?? [];
  const submit = useMutation({
    mutationFn: async () => {
      const response = await agentFetch(slug, "/api/local-hands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: mode,
          riskLevel: "read_only",
          requiresConfirmation: false,
          targetConnectorId: "mac-studio",
          requestedBy: "operator-browser-panel",
          input:
            mode === "x.research"
              ? { query: query.trim(), maxResults: 10 }
              : { url: query.trim() },
        }),
      });
      if (!response.ok)
        throw new Error(
          "Could not queue research. Check the query or URL and retry.",
        );
    },
    onSuccess: async () => {
      setQuery("");
      await client.invalidateQueries({ queryKey });
    },
  });
  return (
    <details className="mb-2 rounded-lg border border-base-300 bg-base-200/40 text-sm">
      <summary className="cursor-pointer px-3 py-2">
        <span className="inline-flex items-center gap-2">
          <StatusDot tone={online ? "success" : "neutral"} /> Studio browser{" "}
          <span className="text-xs text-base-content/60">
            {online ? "online" : "offline"}
            {actions.some(
              (action) =>
                action.status === "claimed" || action.status === "queued",
            )
              ? " · research pending"
              : ""}
          </span>
        </span>
      </summary>
      <div className="max-h-[45dvh] space-y-3 overflow-y-auto px-3 pb-3">
        <p className="text-xs text-base-content/60">
          Read X as @gogameye on Mac Studio. No posting or account changes.{" "}
          {studio
            ? `Last seen ${new Date(studio.lastSeenAt).toLocaleString()}.`
            : "Waiting for Studio to connect."}
        </p>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <label className="flex items-center gap-2 text-xs">
            Source
            <select
              className="select select-sm"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value);
                setQuery("");
              }}
            >
              <option value="x.research">Search X</option>
              <option value="browser">Read a source URL</option>
            </select>
          </label>
          <input
            className="input w-full text-base"
            aria-label={mode === "x.research" ? "X search query" : "Source URL"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={mode === "x.research" ? 1000 : 2000}
            required
            type={mode === "browser" ? "url" : "text"}
            placeholder={
              mode === "x.research"
                ? 'AI (gamedev OR "game development") -filter:replies'
                : "https://github.com/trycua/cua"
            }
          />
          <button
            className="btn btn-primary btn-sm min-h-11"
            disabled={!query.trim() || submit.isPending}
          >
            {submit.isPending ? "Queuing…" : "Research on Studio"}
          </button>
          {!online && (
            <p className="text-xs text-warning">
              Work waits until Studio is awake and connected. Unstarted requests
              expire after 24 hours.
            </p>
          )}
          {mode === "browser" && (
            <p className="text-xs text-base-content/60">
              X post links, GitHub, Hugging Face, Cloudflare docs, OpenAI,
              TypeSafe and Cua public pages.
            </p>
          )}
        </form>
        {(snapshot.error || submit.error) && (
          <p role="alert" className="text-xs text-error">
            {(snapshot.error || submit.error)?.message}
          </p>
        )}
        {actions.map((action) => (
          <div
            className="border-t border-base-300 pt-2 text-xs"
            key={action.id}
          >
            <p className="break-words font-medium">
              {typeof action.input.query === "string"
                ? action.input.query
                : typeof action.input.url === "string"
                  ? action.input.url
                  : "Browser research"}
            </p>
            <p className="mt-1">
              {action.status === "queued" &&
              action.expiresAt &&
              action.expiresAt <= Date.now()
                ? "Expired — submit again to retry"
                : action.status === "claimed"
                  ? "Reading on Studio…"
                  : action.status === "queued"
                    ? "Queued for Studio"
                    : action.status}
            </p>
            {action.status === "claimed" &&
              action.claimedAt &&
              Date.now() - action.claimedAt > 120_000 && (
                <p className="text-warning">
                  Taking longer than expected. Studio may be reconnecting to
                  deliver the result.
                </p>
              )}
            {action.status === "failed" && (
              <p className="text-error">{action.error}</p>
            )}
            {action.status === "completed" && (
              <a
                className="link inline-block py-2"
                href={`/agent/${encodeURIComponent(slug)}/workspace/${browserResearchPath(action.id)}`}
              >
                Open research report
              </a>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
