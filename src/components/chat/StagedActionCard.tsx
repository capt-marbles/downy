import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, ExternalLink, X } from "lucide-react";
import { z } from "zod";
import { agentFetch } from "../../lib/agent-request";
import { useCurrentAgentSlug } from "../../lib/agents";
import {
  describeStagedAction,
  isStagedActionOpen,
  STAGED_ACTION_LABELS,
  StagedActionSchema,
  type StagedAction,
} from "../../lib/staged-actions";

const ReplySchema = z.object({
  action: StagedActionSchema.nullable(),
  error: z.string().nullable().optional(),
});

const STATE_TEXT: Record<StagedAction["state"], string> = {
  proposed: "Awaiting your confirmation. Nothing has run.",
  executing: "Running…",
  succeeded: "Done.",
  failed: "Failed. Nothing was changed.",
  unknown: "Outcome unknown. Check the destination before trying again.",
  cancelled: "Cancelled. Nothing ran.",
};

// The only way to run a proposal. Confirmation quotes the revision the card
// showed, so a proposal that changed underneath the operator is rejected.
export default function StagedActionCard({
  stagedActionId,
}: {
  stagedActionId: string;
}) {
  const slug = useCurrentAgentSlug();
  const client = useQueryClient();
  const queryKey = ["staged-action", slug, stagedActionId];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await agentFetch(
        slug,
        `/api/staged-actions?id=${encodeURIComponent(stagedActionId)}`,
      );
      if (!response.ok)
        throw new Error("This proposal could not be loaded. Reload chat.");
      return ReplySchema.parse(await response.json()).action;
    },
    refetchInterval: (state) =>
      state.state.data?.state === "executing" ? 2000 : false,
  });
  const decide = useMutation({
    mutationFn: async (decision: "confirm" | "cancel") => {
      const current = query.data;
      if (!current) throw new Error("Proposal not loaded.");
      const response = await agentFetch(
        slug,
        `/api/staged-actions?id=${encodeURIComponent(stagedActionId)}&${decision}=1`,
        decision === "confirm"
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ revision: current.revision }),
            }
          : { method: "POST" },
      );
      const result = ReplySchema.safeParse(await response.json());
      if (result.success && result.data.action)
        client.setQueryData(queryKey, result.data.action);
      if (!response.ok || !result.success || result.data.error)
        throw new Error(
          result.success
            ? result.data.error || "Could not update the proposal."
            : "Could not update the proposal.",
        );
    },
  });
  const action = query.data;
  const error = decide.error || query.error;
  if (!action)
    return (
      <p role="status" className="my-3 text-sm text-base-content/60">
        {error?.message || "Loading proposal…"}
      </p>
    );
  const { title, lines } = describeStagedAction(action.payload);
  const open = isStagedActionOpen(action, Date.now());
  const expired = action.state === "proposed" && !open;
  return (
    <section
      id={`staged-action-${action.id}`}
      data-kind="staged-action"
      data-state={action.state}
      className="my-4 rounded-xl border border-base-300 bg-base-200/30 p-3 sm:p-4"
    >
      <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
        <ClipboardCheck size={14} />
        Proposed {STAGED_ACTION_LABELS[action.payload.kind]}
        {action.source === "voice" ? " · from your call" : ""}
      </p>
      <h2 className="text-base font-semibold">{title}</h2>
      <dl className="mt-3 grid min-w-0 gap-2 text-sm">
        {lines.map((line) => {
          const [label, ...rest] = line.split(/:\s?/);
          const value = rest.join(": ");
          return (
            <div key={line} className="min-w-0">
              <dt className="text-xs text-base-content/55">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">{value}</dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-11 gap-2"
          disabled={!open || decide.isPending}
          onClick={() => decide.mutate("confirm")}
        >
          <Check size={15} />
          {action.state === "succeeded"
            ? "Confirmed"
            : decide.isPending
              ? "Working…"
              : "Confirm and run"}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm min-h-11 gap-2"
          disabled={!open || decide.isPending}
          onClick={() => decide.mutate("cancel")}
        >
          <X size={15} />
          Cancel
        </button>
      </div>
      <div
        aria-live="polite"
        className="mt-3 text-xs leading-relaxed text-base-content/65"
      >
        <p>
          {expired
            ? "This proposal expired. Ask for a fresh one."
            : STATE_TEXT[action.state]}
        </p>
        {action.result && (
          <p className="mt-1">
            {action.result.receipt}{" "}
            {action.result.url && (
              <a
                href={action.result.url}
                target="_blank"
                rel="noreferrer"
                className="link inline-flex items-center gap-1"
              >
                Open <ExternalLink size={12} />
              </a>
            )}
          </p>
        )}
        {action.error && (
          <p role="alert" className="mt-1 text-error">
            {action.error}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-error">
            {error.message}
          </p>
        )}
        {open && (
          <p className="mt-1">
            Only this button runs it. Saying yes in chat or on a call does not.
          </p>
        )}
      </div>
    </section>
  );
}
