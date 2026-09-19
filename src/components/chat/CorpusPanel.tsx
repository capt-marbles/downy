import { agentFetch } from "../../lib/agent-request";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
const StatusSchema = z.object({
  repos: z.array(
    z.object({
      key: z.string(),
      last_synced_at: z.number().nullable().optional(),
      file_count: z.number().optional(),
      last_error: z.string().nullable().optional(),
      pending: z.number().optional(),
    }),
  ),
});
export default function CorpusPanel({ slug }: { slug: string }) {
  const client = useQueryClient();
  const queryKey = ["corpus", slug];
  const status = useQuery({
    queryKey,
    refetchInterval: 15_000,
    queryFn: async () => {
      const response = await agentFetch(slug, "/api/corpus");
      if (!response.ok) throw new Error("Could not load corpus status");
      return StatusSchema.parse(await response.json());
    },
  });
  const sync = useMutation({
    mutationFn: async (key: string) => {
      const response = await agentFetch(slug, "/api/corpus/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!response.ok) throw new Error("Corpus sync failed");
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return (
    <section className="my-6 border-t border-base-300 py-4">
      <h2 className="font-semibold">Source corpus</h2>
      {status.data?.repos.length === 0 && (
        <p className="mt-2 text-sm text-base-content/60">
          No source repositories configured.
        </p>
      )}
      {status.data?.repos.map((repo) => (
        <div
          key={repo.key}
          className="my-3 flex items-start justify-between gap-3 text-sm"
        >
          <div>
            <strong>{repo.key}</strong>
            <p>
              {repo.file_count ?? 0} files ·{" "}
              {repo.last_synced_at
                ? new Date(repo.last_synced_at).toLocaleString()
                : "Not synced yet"}
              {repo.pending ? " · Continuing next batch" : ""}
            </p>
            {repo.last_error && <p className="text-error">{repo.last_error}</p>}
          </div>
          <button
            className="btn btn-sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate(repo.key)}
          >
            Sync source
          </button>
        </div>
      ))}
      {(status.error || sync.error) && (
        <p role="alert" className="text-error">
          {(status.error || sync.error)?.message}
        </p>
      )}
    </section>
  );
}
