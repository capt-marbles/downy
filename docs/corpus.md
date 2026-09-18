# GitLab source corpus

`CORPUS_REPOS` is a Worker var containing JSON, not agent-editable configuration:

```json
[
  {
    "key": "gameye-marketing",
    "projectId": "group/marketing",
    "ref": "main",
    "include": ["src/content/**", "src/pages/**"],
    "extensions": [".md", ".mdx"]
  },
  {
    "key": "gameye-docs",
    "projectId": "group/docs",
    "ref": "main",
    "include": ["src/content/**", "src/pages/**"],
    "extensions": [".md", ".mdx"]
  }
]
```

Replace example project paths with real IDs or URL-encoded paths. The default is
an empty array, so nothing syncs until configured. `GITLAB_BASE_URL` defaults to
`https://gitlab.com`. Provision `DOWNY_GITLAB_TOKEN` (read_api + read_repository)
and `DOWNY_GITLAB_WEBHOOK_SECRET` in Secrets Store; Worker bindings are
`GITLAB_TOKEN` and `GITLAB_WEBHOOK_SECRET`. Neither reaches the agent.

Configure a push webhook to `/api/corpus/gitlab-webhook`, set its secret token,
and add custom `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers using a
Cloudflare Access service token allowed by the app policy. The route stays behind
Access; there is no bypass. The Worker compares the GitLab token in constant time
before parsing events or making any GitLab calls.

The existing five-minute cron checks D1 and starts full reconciliation at most
hourly per agent/repo. Bounded continuations can run on intervening ticks. The
settings panel shows last sync, file count and last error, and offers a manual
sync button (`POST /api/corpus/sync`, `{ "key": "gameye-docs" }`).

Files mirror into `workspace/corpus/<key>/<repo path>`. A `.manifest.json` records
blob IDs and the last commit. Full tree reads paginate at 100 entries; unchanged
blobs aren't fetched again. Reads pin a commit to avoid mixed revisions. Removed
paths are deleted only after a complete tree scan. Files over 1 MiB are skipped
and recorded. A conservative 600-operation budget reserves headroom below the
Worker's subrequest limit, storing a cursor for the next invocation. Webhooks
inspect only paths named by the push event; hourly reconciliation repairs missed
or truncated webhooks.

This mirrors **SOURCE content**, preserving Markdown, MDX and frontmatter.
Competitor websites are a separate problem and belong to Browser Rendering.
