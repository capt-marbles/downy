import { useMutation, useQuery } from "@tanstack/react-query";
import { agentFetch } from "../../lib/agent-request";
import { useCurrentAgentSlug } from "../../lib/agents";
import { AirtableConnectStatusSchema } from "../../lib/airtable-connect";
import StatusDot from "../ui/StatusDot";
import ComposioConnectCard from "./ComposioConnectCard";

export default function AirtableConnectCard() {
  const slug = useCurrentAgentSlug();
  const status = useQuery({
    queryKey: ["airtable-connect", slug],
    queryFn: async () => {
      const response = await agentFetch(slug, "/api/composio/oauth/airtable");
      if (!response.ok)
        throw new Error(
          "Could not check Airtable. Retry; your Composio sign-in is preserved.",
        );
      return AirtableConnectStatusSchema.parse(await response.json());
    },
    refetchInterval: (query) =>
      query.state.data?.state === "pending" ? 5000 : 30000,
    refetchIntervalInBackground: false,
  });
  const connection = status.data;
  const select = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await agentFetch(
        slug,
        "/api/composio/oauth/airtable/select",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        },
      );
      if (!response.ok)
        throw new Error(
          "Could not verify that Airtable account. Your sign-in is preserved; please retry.",
        );
    },
    onSuccess: () => {
      void status.refetch();
    },
  });
  const ready = connection?.state === "ready" && connection.authorized;
  const pending = connection?.state === "pending";
  const needsSelection =
    connection?.state === "needs_selection" && connection.authorized;
  return (
    <section
      data-kind="airtable-connect"
      className="my-4 rounded-lg border border-base-300 bg-base-100 p-4"
    >
      <div className="flex items-center gap-2">
        <StatusDot
          tone={ready ? "success" : pending ? "warning" : "neutral"}
          pulse={pending}
        />
        <h3 className="font-semibold">Airtable · Composio</h3>
      </div>
      <p className="mt-2 text-sm">
        List bases, inspect table schemas, and read records in the bases you
        authorize.
      </p>
      <p className="mt-2 text-xs text-base-content/60">
        Sign-in stays outside chat. Choose the bases to share on Airtable’s
        authorization screen. This connection cannot create, update or delete
        records.
      </p>
      {!connection && !status.error && (
        <p className="mt-3 text-sm">Checking connection…</p>
      )}
      {connection?.state === "needs_composio" && <ComposioConnectCard />}
      {connection &&
        connection.state !== "needs_composio" &&
        !ready &&
        !needsSelection && (
          <form
            action={`/api/composio/oauth/airtable/start?agentSlug=${encodeURIComponent(slug)}`}
            method="post"
            target="_blank"
            rel="noopener"
            className="mt-3"
          >
            <button className="btn btn-primary btn-sm" type="submit">
              {pending ? "Continue Airtable sign-in" : "Connect Airtable"}
            </button>
          </form>
        )}
      {needsSelection && (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm">
            Airtable is authorized. Choose which account Downy should use for
            reading records.
          </p>
          {connection.accounts?.map((account) => (
            <button
              key={account.id}
              type="button"
              className="btn btn-outline btn-sm mr-2"
              disabled={select.isPending}
              onClick={() => select.mutate(account.id)}
            >
              Use {account.label}
            </button>
          ))}
          {!connection.accounts?.length && (
            <p className="text-sm">
              No active account is available yet. Retry status shortly.
            </p>
          )}
          {select.isPending && (
            <p role="status" className="text-sm">
              Verifying account…
            </p>
          )}
          {select.error && (
            <p role="alert" className="text-sm text-error">
              {select.error.message}
            </p>
          )}
        </div>
      )}
      {pending && (
        <p role="status" className="mt-2 text-sm">
          Waiting for Airtable authorization. Return to this chat afterward; the
          card updates automatically.
        </p>
      )}
      {ready && (
        <p role="status" className="mt-3 text-sm">
          Connected{connection.identity ? ` as ${connection.identity}` : ""}.
          Base, schema and record reads are available.
        </p>
      )}
      {(status.error || connection?.error) && (
        <p role="alert" className="mt-3 text-sm text-error">
          {connection?.error ??
            "Could not check Airtable. Retry; your Composio sign-in is preserved."}
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
