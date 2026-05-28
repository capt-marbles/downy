#!/usr/bin/env node

import { execFile } from "node:child_process";
import { homedir } from "node:os";
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
const jcodeBin = process.env.DOWNY_HANDS_JCODE_BIN ?? "jcode";
const jcodeTimeoutMs = Number(
  process.env.DOWNY_HANDS_JCODE_TIMEOUT_MS ?? "300000",
);
const grokResearchCommand = process.env.DOWNY_HANDS_GROK_RESEARCH_CMD;
const grokResearchTimeoutMs = Number(
  process.env.DOWNY_HANDS_GROK_RESEARCH_TIMEOUT_MS ?? "300000",
);
const allowedRoots = (process.env.DOWNY_HANDS_ALLOWED_ROOTS ?? homedir())
  .split(path.delimiter)
  .map((entry) => path.resolve(entry))
  .filter(Boolean);

const capabilities = [
  "shell.read",
  "filesystem.read",
  "browser.automation",
  "xurl.research",
  "x.research",
  "grok.research",
  "jcode.coding",
  "git.read",
];

function headers() {
  const value = {
    "content-type": "application/json",
    "x-agent-slug": agentSlug,
  };
  if (accessClientId && accessClientSecret) {
    value["cf-access-client-id"] = accessClientId;
    value["cf-access-client-secret"] = accessClientSecret;
  }
  return value;
}

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }
  return response.json();
}

async function heartbeat() {
  await post("/api/local-hands/heartbeat", {
    connectorId,
    name: `Downy Hands on ${process.env.HOSTNAME ?? "local"}`,
    capabilities,
  });
}

async function claim() {
  return post("/api/local-hands/claim", { connectorId, capabilities });
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
      `local hands jcode input.${name} must be a non-empty string`,
    );
  }
  return value.trim();
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

async function executeJcode(action) {
  if (action.riskLevel !== "read_only") {
    throw new Error("Jcode executor currently only accepts read_only actions");
  }
  const task = requireString(action.input?.task, "task");
  const cwd = safeWorkingDirectory(action.input?.workingDirectory);
  const model =
    typeof action.input?.model === "string" ? action.input.model : null;
  const provider =
    typeof action.input?.provider === "string" ? action.input.provider : null;
  const prompt = [
    "You are being invoked by Downy's local hands connector in READ-ONLY mode.",
    "Do not modify files, run destructive commands, commit, push, deploy, or change external state.",
    "Inspect and report only. If the task requires writes, explain the required follow-up instead of doing it.",
    "",
    task,
  ].join("\n");
  const args = ["run", "--json", "--quiet", "-C", cwd];
  if (provider) args.push("--provider", provider);
  if (model) args.push("--model", model);
  args.push(prompt);
  const startedAt = Date.now();
  const { stdout, stderr } = await execFileAsync(jcodeBin, args, {
    cwd,
    timeout: jcodeTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, JCODE_NON_INTERACTIVE: "1" },
  });
  return {
    mode: "jcode.read_only",
    command: jcodeBin,
    args: args.slice(0, -1),
    cwd,
    durationMs: Date.now() - startedAt,
    stdout: stdout.slice(-200_000),
    stderr: stderr.slice(-50_000),
  };
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
  if (action.kind === "jcode") return executeJcode(action);
  if (action.kind === "grok.research" || action.kind === "x.research") {
    return executeGrokResearch(action);
  }
  return {
    mode: "skeleton",
    message:
      "Local hands connector received the action but no executor is enabled yet for this kind.",
    action: {
      id: action.id,
      kind: action.kind,
      riskLevel: action.riskLevel,
      input: action.input,
    },
  };
}

async function handleClaimedAction(action) {
  console.log(`claimed ${action.id} (${action.kind}, ${action.riskLevel})`);
  try {
    const result = await executeAction(action);
    await complete(action, "completed", result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await complete(action, "failed", null, message);
    console.error(`failed ${action.id}: ${message}`);
  }
}

async function loop() {
  console.log(`Downy hands connecting to ${baseUrl} for agent ${agentSlug}`);
  console.log(`Allowed local roots: ${allowedRoots.join(", ")}`);
  for (;;) {
    try {
      await heartbeat();
      const { action } = await claim();
      if (action) await handleClaimedAction(action);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    if (process.env.DOWNY_HANDS_ONCE === "1") return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

await loop();
