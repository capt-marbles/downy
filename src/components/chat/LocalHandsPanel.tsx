import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  LocalHandsActionSchema,
  LocalHandsConnectorSchema,
} from "../../worker/local-hands/types";
import StatusDot from "../ui/StatusDot";

const SnapshotSchema = z.object({
  actions: z.array(LocalHandsActionSchema),
  connectors: z.array(
    LocalHandsConnectorSchema.extend({ queuedCount: z.number() }),
  ),
  unclaimableActions: z.array(LocalHandsActionSchema),
});

export default function LocalHandsPanel({ slug }: { slug: string }) {
  const client = useQueryClient();
  const queryKey = ["local-hands", slug];
  const { data, error } = useQuery({
    queryKey,
    refetchInterval: 15_000,
    queryFn: async () => {
      const response = await fetch("/api/local-hands", {
        headers: { "x-agent-slug": slug },
      });
      if (!response.ok) throw new Error("Could not load local hands");
      return SnapshotSchema.parse(await response.json());
    },
  });
  const confirmation = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      const response = await fetch("/api/local-hands/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-slug": slug },
        body: JSON.stringify({ id, approved }),
      });
      if (!response.ok) throw new Error("Confirmation failed");
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return (
    <section
      className="border-t border-base-300/70 px-3 py-4 text-xs"
      aria-label="Local hands"
    >
      <h2 className="mb-3 font-semibold">Local hands</h2>
      {(error || confirmation.error) && (
        <p role="alert">{(error || confirmation.error)?.message}</p>
      )}
      {data?.connectors.map((connector) => (
        <div key={connector.id} className="mb-3">
          <div className="flex items-center gap-2">
            <StatusDot
              tone={connector.status === "online" ? "success" : "neutral"}
            />
            <strong>{connector.name}</strong>
            <span>{connector.status}</span>
          </div>
          <p className="text-base-content/60">
            Last seen {new Date(connector.lastSeenAt).toLocaleString()} ·{" "}
            {connector.queuedCount} queued
          </p>
        </div>
      ))}
      {data?.connectors.length === 0 && <p>No connectors have checked in.</p>}
      {(data?.unclaimableActions.length ?? 0) > 0 && (
        <div className="my-3 text-warning">
          <strong>
            {data?.unclaimableActions.length} waiting for a matching online
            machine
          </strong>
          {data?.unclaimableActions.map((action) => (
            <p key={action.id}>
              {action.kind} ·{" "}
              {action.targetConnectorId ?? "no matching connector"}
            </p>
          ))}
        </div>
      )}
      {data?.actions
        .filter((action) => action.status === "pending_confirmation")
        .map((action) => (
          <div
            key={action.id}
            className="mt-3 rounded border border-base-300 p-2"
          >
            <p className="font-semibold">
              Confirm {action.kind} · {action.riskLevel}
            </p>
            <pre className="my-2 max-h-32 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(action.input, null, 2)}
            </pre>
            <button
              className="btn btn-primary btn-xs mr-2"
              disabled={confirmation.isPending}
              onClick={() =>
                confirmation.mutate({ id: action.id, approved: true })
              }
            >
              Approve
            </button>
            <button
              className="btn btn-ghost btn-xs"
              disabled={confirmation.isPending}
              onClick={() =>
                confirmation.mutate({ id: action.id, approved: false })
              }
            >
              Reject
            </button>
          </div>
        ))}
    </section>
  );
}
