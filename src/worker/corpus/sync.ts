import { z } from "zod";
import { normalizeWorkspacePath } from "../agent/child-workspace-rpc";
import { readFetchBytes } from "../local-hands/upload";
import { ManifestSchema, type CorpusRepo, type CorpusCursor } from "./types";

type CorpusWorkspace = {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<unknown>;
  rm(path: string): Promise<unknown>;
  exists(path: string): Promise<boolean>;
};
function included(repo: CorpusRepo, path: string): boolean {
  normalizeWorkspacePath(path); // Validate even paths that filters would skip.
  return (
    repo.extensions.some((ext) => path.endsWith(ext)) &&
    repo.include.some((glob) => {
      const pattern = glob
        .split(/(\*\*\/|\*\*|\*)/)
        .map((part) =>
          part === "**/"
            ? "(?:.*/)?"
            : part === "**"
              ? ".*"
              : part === "*"
                ? "[^/]*"
                : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("");
      return new RegExp(`^${pattern}$`).test(path);
    })
  );
}
export async function syncCorpus(args: {
  repo: CorpusRepo;
  workspace: CorpusWorkspace;
  token: string;
  baseUrl: string;
  cursor?: CorpusCursor | null;
  changedPaths?: string[];
  budget?: number;
}) {
  const { repo, workspace } = args;
  const root = normalizeWorkspacePath(`workspace/corpus/${repo.key}`);
  const filePath = (path: string) => {
    normalizeWorkspacePath(path);
    return normalizeWorkspacePath(`${root}/${path}`);
  };
  const project = encodeURIComponent(decodeURIComponent(repo.projectId));
  const api = `${args.baseUrl.replace(/\/$/, "")}/api/v4/projects/${project}`;
  const budget = args.budget ?? 600;
  let used = 0;
  const gitlab = async (suffix: string, method = "GET") => {
    used += 1;
    const response = await fetch(`${api}${suffix}`, {
      method,
      headers: { "PRIVATE-TOKEN": args.token },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`GitLab request failed (${response.status})`);
    return response;
  };
  let cursor = args.cursor;
  if (!cursor) {
    const raw = await workspace.readFile(`${root}/.manifest.json`);
    const manifest = raw
      ? ManifestSchema.parse(JSON.parse(raw) as unknown)
      : { commit: "", files: {} };
    const commitResponse = await gitlab(
      `/repository/commits/${encodeURIComponent(repo.ref)}`,
    );
    const commit = z
      .object({ id: z.string() })
      .parse(await commitResponse.json()).id;
    const changed = args.changedPaths?.filter((path) => included(repo, path));
    cursor = {
      commit,
      page: 1,
      tree: {},
      paths: changed ?? null,
      index: 0,
      removals: [],
      removeIndex: 0,
      partial: changed != null,
      manifest,
    };
  }
  const ref = encodeURIComponent(cursor.commit);
  const hasBudget = () => used < budget - 10;
  // Complete the paginated tree before making deletion decisions. Persist the
  // accumulated tree if this invocation runs out of its conservative budget.
  while (cursor.paths === null && hasBudget()) {
    const response = await gitlab(
      `/repository/tree?ref=${ref}&recursive=true&per_page=100&page=${cursor.page}`,
    );
    if (!response.ok)
      throw new Error("GitLab tree unavailable; refusing deletions");
    const entries = z
      .array(z.object({ id: z.string(), path: z.string(), type: z.string() }))
      .parse(await response.json());
    for (const entry of entries) {
      normalizeWorkspacePath(entry.path);
      if (entry.type === "blob" && included(repo, entry.path))
        cursor.tree[entry.path] = entry.id;
    }
    const nextPage = response.headers.get("x-next-page");
    if (nextPage === "" || (nextPage === null && entries.length < 100)) {
      cursor.paths = Object.keys(cursor.tree);
      cursor.removals = Object.keys(cursor.manifest.files).filter(
        (path) => !(path in cursor.tree),
      );
    } else cursor.page = nextPage ? Number(nextPage) : cursor.page + 1;
  }
  const paths = cursor.paths ?? [];
  while (cursor.paths && cursor.index < paths.length && hasBudget()) {
    const path = paths[cursor.index];
    const destination = filePath(path);
    const endpoint = `/repository/files/${encodeURIComponent(path)}`;
    let blobId = cursor.tree[path];
    let size = 0;
    if (cursor.partial) {
      const metadata = await gitlab(`${endpoint}?ref=${ref}`, "HEAD");
      const identity = readBlobIdentity(metadata);
      if (!identity) {
        cursor.removals.push(path);
        cursor.index += 1;
        continue;
      }
      ({ blobId, size } = identity);
    }
    if (cursor.manifest.files[path]?.blobId !== blobId) {
      let skipped = size > 1_048_576;
      if (!skipped) {
        const raw = await gitlab(`${endpoint}/raw?ref=${ref}`);
        if (!raw.ok || !raw.body) throw new Error("GitLab source unavailable");
        const content = await sourceContent(raw);
        skipped = content === null;
        if (content !== null) await workspace.writeFile(destination, content);
        used += 3; // Reserve workspace/R2 operations too.
      }
      if (skipped && (await workspace.exists(destination)))
        await workspace.rm(destination);
      cursor.manifest.files[path] = {
        blobId,
        ...(skipped ? { skipped: "over 1 MiB" } : {}),
      };
    }
    cursor.index += 1;
  }
  while (
    cursor.paths &&
    cursor.index === paths.length &&
    cursor.removeIndex < cursor.removals.length &&
    hasBudget()
  ) {
    const path = cursor.removals[cursor.removeIndex];
    const destination = filePath(path);
    if (await workspace.exists(destination)) await workspace.rm(destination);
    delete cursor.manifest.files[path];
    cursor.removeIndex += 1;
    used += 3;
  }
  const done =
    cursor.paths !== null &&
    cursor.index === paths.length &&
    cursor.removeIndex === cursor.removals.length;
  if (done) cursor.manifest.commit = cursor.commit;
  await workspace.writeFile(
    `${root}/.manifest.json`,
    JSON.stringify(cursor.manifest, null, 2),
  );
  return {
    cursor: done ? null : cursor,
    fileCount: Object.values(cursor.manifest.files).filter(
      (file) => !file.skipped,
    ).length,
    commit: cursor.manifest.commit,
    done,
  };
}

async function sourceContent(response: Response): Promise<string | null> {
  if (!response.body) throw new Error("GitLab source unavailable");
  if (Number(response.headers.get("content-length") ?? 0) > 1_048_576) {
    await response.body.cancel();
    return null;
  }
  try {
    return new TextDecoder().decode(
      await readFetchBytes(response.body, 1_048_576),
    );
  } catch (error) {
    if (!String(error).includes("FETCH_TOO_LARGE")) throw error;
    return null;
  }
}

function readBlobIdentity(metadata: Response) {
  if (metadata.status === 404) return null;
  const blobId = metadata.headers.get("x-gitlab-blob-id");
  if (!blobId) throw new Error("Missing GitLab blob identity");
  return { blobId, size: Number(metadata.headers.get("x-gitlab-size") ?? 0) };
}
