import { corpusRepos } from "../corpus/types";
import { readSecret } from "../credentials/crypto";
import { readPush } from "../corpus/webhook";
import { runCorpusRepo } from "../corpus/runner";
import { slugFromRequest } from "../lib/get-agent";
import { listAgents } from "../db/profile";
import { z } from "zod";
export async function handleCorpusRequest(
  request: Request,
  env: Cloudflare.Env,
) {
  try {
    const pathname = new URL(request.url).pathname;
    if (
      pathname === "/api/corpus/gitlab-webhook" &&
      request.method === "POST"
    ) {
      const push = await readPush(
        request,
        await readSecret(env.GITLAB_WEBHOOK_SECRET),
      );
      if (!push)
        return Response.json(
          { error: "Invalid webhook token" },
          { status: 403 },
        );
      const paths = [
        ...new Set(
          push.commits.flatMap((commit) => [
            ...commit.added,
            ...commit.modified,
            ...commit.removed,
          ]),
        ),
      ];
      for (const repo of corpusRepos(env.CORPUS_REPOS)) {
        if (
          push.ref !== `refs/heads/${repo.ref}` ||
          ![String(push.project.id), push.project.path_with_namespace].includes(
            decodeURIComponent(repo.projectId),
          )
        )
          continue;
        for (const agent of await listAgents(env.DB))
          await runCorpusRepo(env, agent.slug, repo, paths, true);
      }
      return Response.json({ accepted: true });
    }
    const slug = slugFromRequest(request);
    const repos = corpusRepos(env.CORPUS_REPOS);
    if (request.method === "POST" && pathname === "/api/corpus/sync") {
      const { key } = z.object({ key: z.string() }).parse(await request.json());
      const repo = repos.find((candidateRepo) => candidateRepo.key === key);
      if (!repo)
        return Response.json({ error: "Unknown corpus repo" }, { status: 404 });
      await runCorpusRepo(env, slug, repo, undefined, true);
    } else if (request.method !== "GET")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    const state = await env.DB.prepare(
      "SELECT repo_key, last_synced_at, file_count, last_error, cursor_json IS NOT NULL AS pending FROM corpus_sync_state WHERE agent_slug = ?",
    )
      .bind(slug)
      .all();
    return Response.json({
      repos: repos.map((repo) => ({
        key: repo.key,
        ...(state.results ?? []).find((row) => row.repo_key === repo.key),
      })),
    });
  } catch {
    return Response.json({ error: "Corpus request failed" }, { status: 400 });
  }
}
