import { useState } from "react";
import { z } from "zod";
import { CredentialTicketSchema } from "../../worker/credentials/types";
import { useCurrentAgentSlug } from "../../lib/agents";
import type { ToolPart } from "./tool-part-types";
const OutcomeSchema = z.object({
  state: z.string(),
  toolNames: z.array(z.string()),
  error: z.string().nullable(),
});

export default function CredentialCard({ part }: { part: ToolPart }) {
  const slug = useCurrentAgentSlug();
  const ticket = CredentialTicketSchema.safeParse(part.output);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<z.infer<typeof OutcomeSchema> | null>(
    null,
  );
  if (!ticket.success)
    return <p className="text-xs">Preparing secure credential entry…</p>;
  const expired = ticket.data.expiresAt <= Date.now();
  return (
    <form
      data-kind="credential-request"
      className="my-3 rounded-lg border border-base-300 bg-base-100 p-4"
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || expired) return;
        const form = event.currentTarget;
        setBusy(true);
        try {
          // Uncontrolled password inputs. Values live only in this submission,
          // never React state, chat messages, analytics, or console logging.
          const values = Object.fromEntries(new FormData(form).entries());
          form.reset();
          const response = await fetch(
            `/api/credentials/${encodeURIComponent(ticket.data.ticketId)}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-agent-slug": slug,
              },
              body: JSON.stringify(values),
            },
          );
          const result = OutcomeSchema.safeParse(await response.json());
          setOutcome(
            result.success
              ? result.data
              : {
                  state: "failed",
                  toolNames: [],
                  error: "Credential submission failed",
                },
          );
        } catch {
          setOutcome({
            state: "failed",
            toolNames: [],
            error: "Credential submission failed",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold">Secure credential entry</h3>
      <p className="mb-3 text-xs text-base-content/60">
        Sent directly to the connection endpoint. Never added to chat. Expires{" "}
        {new Date(ticket.data.expiresAt).toLocaleTimeString()}.
      </p>
      {ticket.data.fields.map((field) => (
        <label key={field.headerName} className="mb-3 block text-sm">
          {field.label}
          <input
            className="input input-bordered mt-1 w-full"
            type="password"
            name={field.headerName}
            autoComplete="off"
            required
            disabled={busy || expired || outcome?.state === "ready"}
          />
          {field.hint && <span className="text-xs">{field.hint}</span>}
        </label>
      ))}
      <button
        className="btn btn-primary btn-sm"
        disabled={busy || expired || outcome != null}
      >
        {expired ? "Ticket expired" : busy ? "Connecting…" : "Connect securely"}
      </button>
      {outcome && (
        <p role="status" className="mt-3 text-sm">
          {outcome.state === "ready"
            ? `Connected: ${outcome.toolNames.join(", ") || "no tools discovered"}`
            : outcome.error}
        </p>
      )}
    </form>
  );
}
