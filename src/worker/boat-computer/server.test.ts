import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";

it("requires the separate bridge credential even for health and initialization and never echoes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "downy-boat-test-"));
  const token = "test-bridge-credential-" + "x".repeat(32);
  const file = join(directory, "token");
  await writeFile(file, token, { mode: 0o600 });
  const portProbe = createServer().listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const address = portProbe.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  await new Promise<void>((resolve) => portProbe.close(() => resolve()));
  const child = spawn(process.execPath, ["boat-computer/server.mjs"], {
    env: {
      ...process.env,
      DOWNY_BOAT_TOKEN_FILE: file,
      DOWNY_BOAT_PORT: String(address.port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data: Buffer) => {
    logs += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    logs += data.toString();
  });
  const base = `http://127.0.0.1:${address.port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(`${base}/health`)).status === 401;
      } catch {
        /* booting */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(ready).toBe(true);
    const denied = await fetch(`${base}/initialize`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
      body: '{"key":"never-process-this"}',
    });
    expect(denied.status).toBe(401);
    const health = await fetch(`${base}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);
    expect(await health.text()).not.toContain(token);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("never-process-this");
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
