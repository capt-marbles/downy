import { useQuery } from "@tanstack/react-query";
import { agentFetch } from "../../lib/agent-request";
import { useCurrentAgentSlug } from "../../lib/agents";
import { GmailConnectStatusSchema } from "../../lib/gmail-connect";
import StatusDot from "../ui/StatusDot";
import ComposioConnectCard from "./ComposioConnectCard";

export default function GmailConnectCard() {
  const slug = useCurrentAgentSlug();
  const status = useQuery({
    queryKey: ["gmail-connect", slug],
    queryFn: async () => {
      const response = await agentFetch(slug, "/api/composio/oauth/gmail");
      if (!response.ok)
        throw new Error(
          "Could not check Gmail. Retry; your Composio sign-in is preserved.",
        );
      return GmailConnectStatusSchema.parse(await response.json());
    },
    refetchInterval: (query) =>
      query.state.data?.state === "pending" ? 5000 : 30000,
    refetchIntervalInBackground: false,
  });
  const connection = status.data;
  const ready = connection?.state === "ready" && connection.authorized;
  const pending = connection?.state === "pending";
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
        Read and search email, and create drafts in Gmail for you to review and
        send.
      </p>
      <p className="mt-2 text-xs text-base-content/60">
        Downy cannot send, forward or delete messages. Google authorization
        stays outside chat. Google may display broader permissions; Downy
        enforces the read-and-draft limit.
      </p>
      {!connection && !status.error && (
        <p className="mt-3 text-sm">Checking connection…</p>
      )}
      {connection?.state === "needs_composio" && <ComposioConnectCard />}
      {connection && connection.state !== "needs_composio" && !ready && (
        <form
          action={`/api/composio/oauth/gmail/start?agentSlug=${encodeURIComponent(slug)}`}
          method="post"
          target="_blank"
          rel="noopener"
          className="mt-3"
        >
          <button className="btn btn-primary btn-sm" type="submit">
            {pending ? "Continue Gmail sign-in" : "Connect Gmail"}
          </button>
        </form>
      )}
      {pending && (
        <p role="status" className="mt-2 text-sm">
          Waiting for Gmail authorization. Return to this chat afterward; the
          card updates automatically.
        </p>
      )}
      {ready && (
        <p role="status" className="mt-3 text-sm">
          Connected{connection.email ? ` as ${connection.email}` : ""}. Reading
          and draft creation are available. You send drafts yourself.
        </p>
      )}
      {(status.error || connection?.error) && (
        <p role="alert" className="mt-3 text-sm text-error">
          {connection?.error ??
            "Could not check Gmail. Retry; your Composio sign-in is preserved."}
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
