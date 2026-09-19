#!/usr/bin/env node

import { executeBrowserResearch } from "./local-hands-browser.mjs";
import { executeFilesystemFetch } from "./local-hands-files.mjs";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const baseUrl =
  process.env.DOWNY_URL ?? "https://downy.andrewdmwalker.workers.dev";
const agentSlug = process.env.DOWNY_AGENT_SLUG ?? "buildroom";
const connectorId =
  process.env.DOWNY_HANDS_CONNECTOR_ID ?? `local-${process.env.USER ?? "user"}`;
const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
const pollIntervalMs = Number(process.env.DOWNY_HANDS_POLL_MS ?? "5000");
const codexBin = process.env.DOWNY_HANDS_CODEX_BIN ?? "codex";
const codexTimeoutMs = Number(
  process.env.DOWNY_HANDS_CODEX_TIMEOUT_MS ?? "300000",
);
const grokResearchCommand = process.env.DOWNY_HANDS_GROK_RESEARCH_CMD;
const grokResearchTimeoutMs = Number(
  process.env.DOWNY_HANDS_GROK_RESEARCH_TIMEOUT_MS ?? "300000",
);
const allowedRoots = (process.env.DOWNY_HANDS_ALLOWED_ROOTS ?? homedir())
  .split(path.delimiter)
  .map((entry) => path.resolve(entry))
  .filter(Boolean);

const asideEnabled = process.env.DOWNY_HANDS_ASIDE_ENABLED === "1";
const browserOnly = process.env.DOWNY_HANDS_BROWSER_ONLY === "1";
const capabilities = [
  ...(browserOnly ? [] : ["filesystem.read", "codex.coding"]),
  ...(asideEnabled ? ["browser.automation", "x.research"] : []),
  ...(!browserOnly && grokResearchCommand ? ["grok.research"] : []),
];
if (!capabilities.length) throw new Error("No local executors enabled");
const stateDirectory =
  process.env.DOWNY_HANDS_STATE_DIR ??
  path.join(
    homedir(),
    ".local",
    "state",
    "downy-hands",
    encodeURIComponent(connectorId),
    encodeURIComponent(agentSlug),
  );
const pendingPath = path.join(stateDirectory, "pending.json");
let cachedAccessToken;
let tokenExpiresAt = 0;
async function headers() {
  const value = {
    "content-type": "application/json",
    "x-agent-slug": agentSlug,
  };
  if (accessClientId && accessClientSecret) {
    value["cf-access-client-id"] = accessClientId;
    value["cf-access-client-secret"] = accessClientSecret;
  } else if (process.env.DOWNY_HANDS_ACCESS_SESSION === "1") {
    if (!cachedAccessToken || Date.now() > tokenExpiresAt - 60_000) {
      try {
        const { stdout } = await execFileAsync(
          process.env.DOWNY_HANDS_CLOUDFLARED_BIN ?? "cloudflared",
          ["access", "token", "--app", baseUrl],
          { timeout: 10_000, maxBuffer: 32_000 },
        );
        const token = stdout.trim();
        const claims = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString(),
        );
        if (!claims.exp || claims.exp * 1000 <= Date.now())
          throw new Error("expired");
        cachedAccessToken = token;
        tokenExpiresAt = claims.exp * 1000;
      } catch {
        throw new Error(
          "ACCESS_LOGIN_REQUIRED: run cloudflared access login for the Downy URL on Studio",
        );
      }
    }
    value.cookie = `CF_Authorization=${cachedAccessToken}`;
  }
  return value;
}

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    if ([302, 401, 403].includes(response.status)) {
      cachedAccessToken = undefined;
      tokenExpiresAt = 0;
    }
    throw new Error(
      `DOWNY_HTTP_${response.status}: request failed; check Access sign-in and connectivity`,
    );
  }
  return response.json();
}

async function savePending(value) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(`${pendingPath}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${pendingPath}.tmp`, pendingPath);
}
async function deliverPending() {
  let pending;
  try {
    pending = JSON.parse(await readFile(pendingPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await complete(pending.action, pending.status, pending.result, pending.error);
  await rm(pendingPath);
  console.log(`delivered ${pending.action.id} (${pending.status})`);
}

async function heartbeat() {
  await post("/api/local-hands/heartbeat", {
    connectorId,
    name: connectorId,
    capabilities,
    allowedRoots,
  });
}

async function claim() {
  return post("/api/local-hands/claim", {
    connectorId,
    kinds: [
      ...(browserOnly ? [] : ["filesystem.fetch", "codex"]),
      ...(asideEnabled ? ["browser", "x.research"] : []),
      ...(!browserOnly && grokResearchCommand ? ["grok.research"] : []),
    ],
    capabilities,
    allowedRoots,
  });
}

async function complete(action, status, result, error = null) {
  await post(`/api/local-hands/${encodeURIComponent(action.id)}/complete`, {
    connectorId,
    status,
    result,
    error,
  });
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `local hands codex input.${name} must be a non-empty string`,
    );
  }
  return value;
}

function safeWorkingDirectory(value) {
  const raw = typeof value === "string" && value.length > 0 ? value : homedir();
  const resolved = path.resolve(raw);
  const allowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
  if (!allowed) {
    throw new Error(
      `workingDirectory ${resolved} is outside DOWNY_HANDS_ALLOWED_ROOTS (${allowedRoots.join(", ")})`,
    );
  }
  return resolved;
}

async function executeCodex(action) {
  if (action.riskLevel !== "read_only") {
    throw new Error("Codex executor currently only accepts read_only actions");
  }
  const task = requireString(action.input?.task, "task");
  const cwd = safeWorkingDirectory(action.input?.workingDirectory);
  const temporary = await mkdtemp(path.join(tmpdir(), "downy-codex-"));
  const output = path.join(temporary, "last-message.txt");
  const args = [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-last-message",
    output,
    task,
  ];
  const startedAt = Date.now();
  try {
    const { stderr } = await execFileAsync(codexBin, args, {
      cwd,
      timeout: codexTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      mode: "codex.read_only",
      command: codexBin,
      args: args.slice(0, -1),
      cwd,
      durationMs: Date.now() - startedAt,
      stdout: (await readFile(output, "utf8")).slice(-200_000),
      stderr: stderr.slice(-50_000),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function contextValue(value) {
  if (typeof value === "string") return parseMaybeJson(value) ?? value;
  if (value && typeof value === "object") return value;
  return null;
}

function contextEnvValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

async function writeCampaignResearchArtifact(payload, research) {
  const context = contextValue(payload.context);
  if (!context || typeof context !== "object") return null;
  const jobId = typeof context.jobId === "string" ? context.jobId : null;
  if (!jobId || payload.outputArtifact !== "campaign-source-notes") return null;
  const artifact = {
    schema_version: 1,
    job_id: jobId,
    agent_slug: agentSlug,
    created_at: new Date().toISOString(),
    created_by: connectorId,
    artifact_type: "campaign-source-notes",
    summary:
      typeof research?.summary === "string"
        ? research.summary
        : `Local Grok/X research completed for: ${payload.query}`,
    sources: Array.isArray(research?.sources) ? research.sources : [],
    claims: Array.isArray(research?.claims) ? research.claims : [],
    opportunities: Array.isArray(research?.opportunities)
      ? research.opportunities
      : [],
    open_questions: Array.isArray(research?.open_questions)
      ? research.open_questions
      : [],
    research_limits:
      typeof research?.research_limits === "string"
        ? research.research_limits
        : "Completed by local Grok/X adapter.",
  };
  return post("/api/campaign-room/artifacts", { jobId, artifact });
}

async function executeGrokResearch(action) {
  if (action.riskLevel !== "read_only") {
    throw new Error("Grok/X research executor only accepts read_only actions");
  }
  if (!grokResearchCommand) {
    throw new Error(
      "DOWNY_HANDS_GROK_RESEARCH_CMD is not set on this local hands daemon",
    );
  }
  const query = requireString(action.input?.query, "query");
  const payload = {
    query,
    mode:
      typeof action.input?.mode === "string"
        ? action.input.mode
        : "research_summary",
    maxResults:
      typeof action.input?.maxResults === "number"
        ? action.input.maxResults
        : 20,
    outputArtifact:
      typeof action.input?.outputArtifact === "string"
        ? action.input.outputArtifact
        : "campaign-source-notes",
    context: contextValue(action.input?.context),
  };
  const startedAt = Date.now();
  const { stdout, stderr } = await execFileAsync(grokResearchCommand, [], {
    timeout: grokResearchTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      DOWNY_GROK_RESEARCH_JSON: JSON.stringify(payload),
      DOWNY_GROK_RESEARCH_QUERY: payload.query,
      DOWNY_GROK_RESEARCH_MODE: payload.mode,
      DOWNY_GROK_RESEARCH_MAX_RESULTS: String(payload.maxResults),
      DOWNY_GROK_RESEARCH_OUTPUT_ARTIFACT: payload.outputArtifact,
      DOWNY_GROK_RESEARCH_CONTEXT: contextEnvValue(payload.context),
    },
  });
  const parsed = parseMaybeJson(stdout.trim());
  const writeback = parsed
    ? await writeCampaignResearchArtifact(payload, parsed)
    : null;
  return {
    mode: "grok.research.read_only",
    command: grokResearchCommand,
    durationMs: Date.now() - startedAt,
    request: payload,
    research: parsed,
    writeback,
    stdout: parsed ? undefined : stdout.slice(-200_000),
    stderr: stderr.slice(-50_000),
  };
}

async function executeAction(action) {
  if (
    asideEnabled &&
    (action.kind === "browser" || action.kind === "x.research")
  )
    return executeBrowserResearch(action, {
      connectorId,
      asideBin: process.env.DOWNY_HANDS_ASIDE_BIN ?? "aside",
      expectedAccount: process.env.DOWNY_HANDS_X_ACCOUNT ?? "gogameye",
      ...(process.env.DOWNY_HANDS_BROWSER_HOSTS
        ? {
            allowedHosts: process.env.DOWNY_HANDS_BROWSER_HOSTS.split(",")
              .map((host) => host.trim())
              .filter(Boolean),
          }
        : {}),
    });
  if (action.kind === "filesystem.fetch")
    return executeFilesystemFetch(action, {
      allowedRoots,
      maxBytes: Number(process.env.DOWNY_MAX_FETCH_BYTES ?? 25 * 1024 * 1024),
      upload: async ({ destName, contentType, body }) => {
        const response = await fetch(
          `${baseUrl}/api/local-hands/${encodeURIComponent(action.id)}/upload`,
          {
            method: "POST",
            duplex: "half",
            body,
            headers: {
              ...(await headers()),
              "content-type": contentType,
              "x-connector-id": connectorId,
              "x-dest-name": destName,
            },
          },
        );
        if (!response.ok)
          throw new Error(
            `Upload failed: ${response.status} ${await response.text()}`,
          );
        return response.json();
      },
    });
  if (action.kind === "codex") return executeCodex(action);
  if (action.kind === "grok.research") {
    return executeGrokResearch(action);
  }
  throw new Error("UNSUPPORTED_ACTION: no executor enabled for this kind");
}

async function handleClaimedAction(action) {
  console.log(`claimed ${action.id} (${action.kind}, ${action.riskLevel})`);
  // Persist an interrupted receipt before running. A restart reports failure;
  // it never blindly repeats an action whose execution outcome is unknown.
  await savePending({
    action: { id: action.id },
    status: "failed",
    result: null,
    error:
      "CONNECTOR_INTERRUPTED: Studio restarted during execution; retry explicitly",
  });
  let pending;
  try {
    pending = {
      action: { id: action.id },
      status: "completed",
      result: await executeAction(action),
      error: null,
    };
  } catch (error) {
    const code =
      String(error.message).match(/^[A-Z][A-Z_]+/)?.[0] ?? "EXECUTOR_FAILED";
    pending = {
      action: { id: action.id },
      status: "failed",
      result: null,
      error: `${code}: Studio could not complete this action. Check the local executor or browser sign-in and retry.`,
    };
  }
  await savePending(pending);
  // Network failures leave the completed receipt on disk. Next loop retries
  // delivery, not executeAction, even after a process restart.
  await deliverPending();
}

async function loop() {
  console.log(`Downy hands connecting to ${baseUrl} for agent ${agentSlug}`);
  console.log(`Allowed local roots: ${allowedRoots.join(", ")}`);
  let heartbeatBusy = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      await heartbeat();
    } catch {
      /* Main loop reports bounded errors. */
    } finally {
      heartbeatBusy = false;
    }
  }, 30_000);
  heartbeatTimer.unref();
  for (;;) {
    try {
      await heartbeat();
      await deliverPending();
      const { action } = await claim();
      if (action) await handleClaimedAction(action);
    } catch (error) {
      console.error(
        error instanceof Error &&
          /^(ACCESS_LOGIN_REQUIRED|DOWNY_HTTP_)/.test(error.message)
          ? error.message
          : "CONNECTOR_RETRY: transport or delivery unavailable; retrying without re-executing",
      );
    }
    if (process.env.DOWNY_HANDS_ONCE === "1") return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

await loop();
