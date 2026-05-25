#!/usr/bin/env node

const baseUrl =
  process.env.DOWNY_URL ?? "https://downy.andrewdmwalker.workers.dev";
const agentSlug = process.env.DOWNY_AGENT_SLUG ?? "buildroom";
const connectorId =
  process.env.DOWNY_HANDS_CONNECTOR_ID ?? `local-${process.env.USER ?? "user"}`;
const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

const capabilities = [
  "shell.read",
  "filesystem.read",
  "browser.automation",
  "xurl.research",
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

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
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

async function executeSkeleton(action) {
  // This is intentionally a protocol skeleton. Real executors are added behind
  // per-capability allowlists and confirmation gates in later steps.
  return {
    mode: "skeleton",
    message:
      "Local hands connector received the action but no executor is enabled yet.",
    action: {
      id: action.id,
      kind: action.kind,
      riskLevel: action.riskLevel,
      input: action.input,
    },
  };
}

async function loop() {
  console.log(
    `Downy hands skeleton connecting to ${baseUrl} for agent ${agentSlug}`,
  );
  for (;;) {
    try {
      await heartbeat();
      const { action } = await claim();
      if (action) {
        console.log(
          `claimed ${action.id} (${action.kind}, ${action.riskLevel})`,
        );
        const result = await executeSkeleton(action);
        await complete(action, "completed", result);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

await loop();
