#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const baseUrl =
  process.env.DOWNY_URL ?? "https://downy.andrewdmwalker.workers.dev";
const agentSlug = process.env.DOWNY_AGENT_SLUG ?? "buildroom";
const connectorId = process.env.DOWNY_HANDS_CONNECTOR_ID ?? "mac-mini";
const workingDirectory = path.resolve(
  process.env.DOWNY_HANDS_SMOKE_WORKDIR ?? repoRoot,
);
const allowedRoots =
  process.env.DOWNY_HANDS_ALLOWED_ROOTS ?? workingDirectory ?? homedir();
const timeoutMs = Number(process.env.DOWNY_HANDS_SMOKE_TIMEOUT_MS ?? "420000");
const pollMs = Number(process.env.DOWNY_HANDS_SMOKE_POLL_MS ?? "2000");
const jcodeBin = process.env.DOWNY_HANDS_JCODE_BIN ?? "jcode";
const smokeToken = `local-hands-smoke-${Date.now()}`;
const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

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

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...headers(), ...options.headers },
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeAccessLogin =
    text.includes("Cloudflare Access") || text.includes("/cdn-cgi/access/");
  if (looksLikeAccessLogin) {
    throw new Error(
      `${options.method ?? "GET"} ${pathname} reached Cloudflare Access login instead of the Downy API. Set valid CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET for the service token, then retry.`,
    );
  }
  if (!contentType.includes("application/json")) {
    throw new Error(
      `${options.method ?? "GET"} ${pathname} expected JSON but received ${contentType || "unknown content type"}: ${text.slice(0, 200)}`,
    );
  }
  const body = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${pathname} failed: ${response.status} ${response.statusText}: ${text}`,
    );
  }
  return body;
}

async function assertExecutable(command) {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  for (const directory of paths) {
    const candidate = path.join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch {
      // Keep searching PATH.
    }
  }
  throw new Error(`Required executable not found on PATH: ${command}`);
}

function runHandsOnce() {
  const child = spawn(process.execPath, ["scripts/downy-hands.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOWNY_URL: baseUrl,
      DOWNY_AGENT_SLUG: agentSlug,
      DOWNY_HANDS_CONNECTOR_ID: connectorId,
      DOWNY_HANDS_ALLOWED_ROOTS: allowedRoots,
      DOWNY_HANDS_JCODE_BIN: jcodeBin,
      DOWNY_HANDS_ONCE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`downy-hands timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `downy-hands exited with ${code ?? signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function findAction(id) {
  const body = await request("/api/local-hands?includeCompleted=true");
  return body?.actions?.find((action) => action.id === id) ?? null;
}

async function waitForCompletedAction(id) {
  const startedAt = Date.now();
  for (;;) {
    const action = await findAction(id);
    if (action?.status === "completed") return action;
    if (action?.status === "failed") {
      throw new Error(
        `Smoke action failed: ${action.error ?? "unknown error"}`,
      );
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for smoke action ${id} to complete`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function main() {
  console.log("Mac Mini local hands smoke test");
  console.log(`Downy URL: ${baseUrl}`);
  console.log(`Agent slug: ${agentSlug}`);
  console.log(`Connector ID: ${connectorId}`);
  console.log(`Working directory: ${workingDirectory}`);
  console.log(`Allowed roots: ${allowedRoots}`);

  await assertExecutable(jcodeBin);

  const createBody = await request("/api/local-hands", {
    method: "POST",
    body: JSON.stringify({
      kind: "jcode",
      riskLevel: "read_only",
      requiresConfirmation: false,
      requestedBy: "mac-mini-smoke-test",
      input: {
        task: [
          `This is a Downy local-hands smoke test token: ${smokeToken}.`,
          "Do not modify anything.",
          "Inspect the current working directory and respond with:",
          "1. the smoke token exactly as given,",
          "2. the repository path,",
          "3. the safest command you would run to typecheck this project, without running it.",
        ].join("\n"),
        workingDirectory,
      },
    }),
  });
  const action = createBody?.action;
  if (!action?.id)
    throw new Error("Create action response did not include action.id");
  if (action.status !== "queued") {
    throw new Error(`Expected queued read-only action, got ${action.status}`);
  }
  console.log(`Created queued action: ${action.id}`);

  const daemonResult = await runHandsOnce();
  process.stdout.write(daemonResult.stdout);
  process.stderr.write(daemonResult.stderr);

  const completed = await waitForCompletedAction(action.id);
  if (completed.claimedBy !== connectorId) {
    throw new Error(
      `Expected action claimed by ${connectorId}, got ${completed.claimedBy}`,
    );
  }
  if (completed.result?.mode !== "jcode.read_only") {
    throw new Error(
      `Expected jcode.read_only result, got ${String(completed.result?.mode)}`,
    );
  }
  const stdout = String(completed.result.stdout ?? "");
  if (!stdout.includes(smokeToken)) {
    throw new Error("Jcode result did not include the smoke token");
  }

  console.log("Smoke test passed");
  console.log(`Action: ${completed.id}`);
  console.log(`Completed at: ${new Date(completed.completedAt).toISOString()}`);
}

await main();
