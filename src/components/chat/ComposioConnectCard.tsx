import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { agentSlugFromPath, useFallbackAgentSlug } from "../../lib/agents";
import { ComposioOAuthStatusSchema } from "../../lib/composio-oauth";
import StatusDot from "../ui/StatusDot";

export default function ComposioConnectCard() {
  const currentSlug = useRouterState({
    select: (state) => agentSlugFromPath(state.location.pathname),
  });
  const fallback = useFallbackAgentSlug();
  const slug = currentSlug ?? fallback;
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["composio-oauth", slug],
    queryFn: async () => {
      const response = await fetch("/api/composio/oauth", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not check Composio status.");
      return ComposioOAuthStatusSchema.parse(await response.json());
    },
    refetchInterval: (query) =>
      query.state.data?.state === "authorizing" ? 3000 : 10000,
    refetchIntervalInBackground: false,
  });
  const connection = status.data;
  const connected = connection?.state === "connected";
  const pending = connection?.state === "authorizing";
  async function disconnect() {
    setError(null);
    try {
      const response = await fetch("/api/composio/oauth/disconnect", {
        method: "POST",
      });
      if (!response.ok) throw new Error();
      await status.refetch();
    } catch {
      setError("Could not disconnect Composio. Please retry.");
    }
  }
  return (
    <section
      data-kind="composio-connect"
      className="my-4 rounded-lg border border-base-300 bg-base-100 p-4"
    >
      <div className="flex items-center gap-2">
        <StatusDot
          tone={connected ? "success" : pending ? "warning" : "neutral"}
          pulse={pending}
        />
        <h3 className="font-semibold">Composio</h3>
        <span role="status" className="ml-auto text-xs text-base-content/60">
          {connected
            ? "Connected"
            : pending
              ? "Awaiting sign-in"
              : !connection
                ? "Checking…"
                : "Not connected"}
        </span>
      </div>
      <p className="mt-2 text-sm">
        Connect your Composio account to start setting up your apps. Sign-in
        opens securely in a new tab.
      </p>
      <p className="mt-2 text-xs text-base-content/60">
        No API key is needed in chat. App permissions, including Gmail access,
        are a separate step.
      </p>
      {connected ? (
        <>
          <p className="mt-3 text-sm">
            Composio is connected. Ask Downy to connect an app in chat.
          </p>
          {connection.checkedAt && (
            <p className="mt-1 text-xs text-base-content/60">
              Last verified {new Date(connection.checkedAt).toLocaleString()}
            </p>
          )}
          <button
            className="btn btn-ghost btn-sm mt-3"
            onClick={() => void disconnect()}
          >
            Disconnect from Downy
          </button>
        </>
      ) : (
        slug && (
          <form
            action={`/api/composio/oauth/start?agentSlug=${encodeURIComponent(slug)}`}
            method="post"
            target="_blank"
            rel="noopener"
            className="mt-3"
          >
            <button className="btn btn-primary btn-sm" type="submit">
              {pending ? "Continue sign-in" : "Connect"}
            </button>
          </form>
        )
      )}
      {pending && (
        <p className="mt-2 text-xs">
          Finish sign-in in the new tab. This card updates automatically.
        </p>
      )}
      {(error || status.error || connection?.error) && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error ?? connection?.error ?? "Could not check Composio status."}
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
