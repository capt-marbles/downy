import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentFetch } from "../../lib/agent-request";
import { useCurrentAgentSlug } from "../../lib/agents";
import { GMAIL_PILOT_TOOLS, GmailConnectionSchema } from "../../lib/composio";
import StatusDot from "../ui/StatusDot";

export default function GmailConnectCard() {
  const slug = useCurrentAgentSlug();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["gmail-connection", slug],
    queryFn: async () => {
      const response = await agentFetch(slug, "/api/composio?gmail=1");
      if (!response.ok)
        throw new Error("Connection status unavailable. Try again.");
      return GmailConnectionSchema.parse(await response.json());
    },
    refetchInterval: (query) =>
      ["pending", "connecting"].includes(query.state.data?.state ?? "")
        ? 3000
        : 15000,
    refetchIntervalInBackground: false,
  });
  const connection = status.data;
  const ready = connection?.state === "ready";
  const pending = ["pending", "connecting"].includes(connection?.state ?? "");
  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await agentFetch(slug, "/api/composio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkit: "gmail",
          allowedTools: GMAIL_PILOT_TOOLS,
        }),
      });
      if (!response.ok)
        throw new Error("Could not start Gmail authorization. Please retry.");
      await status.refetch();
    } catch {
      setError("Could not start Gmail authorization. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      data-kind="gmail-connect"
      className="my-4 rounded-lg border border-base-300 bg-base-100 p-4"
    >
      <div className="flex items-center gap-2">
        <StatusDot
          tone={ready ? "success" : pending ? "warning" : "neutral"}
          pulse={pending}
        />
        <h3 className="font-semibold">Gmail · Composio</h3>
      </div>
      <p className="mt-2 text-sm">
        Connect your Gmail account so Downy can find and read email. This first
        test cannot send, delete or change messages.
      </p>
      <p className="mt-2 text-xs text-base-content/60">
        Google sign-in opens securely outside chat. Downy receives connection
        status, never your password or OAuth tokens.
      </p>
      {!connection && !status.error && (
        <p className="mt-3 text-sm">Checking connection…</p>
      )}
      {connection && !connection.configured && (
        <p role="status" className="mt-3 text-sm">
          One-time Composio administrator setup is needed before you can connect
          Gmail. Never paste the project key into chat.
        </p>
      )}
      {connection?.configured && !ready && !pending && (
        <button
          className="btn btn-primary btn-sm mt-3"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? "Preparing secure sign-in…" : "Connect Gmail"}
        </button>
      )}
      {pending && !connection?.redirectUrl && (
        <p role="status" className="mt-3 text-sm">
          Finishing your connection…
        </p>
      )}
      {pending && connection?.redirectUrl && (
        <>
          <a
            className="btn btn-primary btn-sm mt-3"
            href={connection.redirectUrl}
            target="_blank"
            rel="noreferrer"
          >
            Authorize Gmail
          </a>
          <p role="status" className="mt-2 text-xs">
            Waiting for Google authorization. You can return to this
            conversation afterward.
          </p>
        </>
      )}
      {ready && (
        <p role="status" className="mt-3 text-sm">
          Connected. Gmail reading tools are available to Downy.
        </p>
      )}
      {(error || status.error || connection?.error) && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error ?? connection?.error ?? "Could not check connection status."}
        </p>
      )}
      {status.error && (
        <button
          className="btn btn-ghost btn-sm mt-2"
          onClick={() => void status.refetch()}
        >
          Retry status
        </button>
      )}
    </section>
  );
}
