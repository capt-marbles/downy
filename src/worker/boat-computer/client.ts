import { z } from "zod";
import { readSecret } from "../credentials/crypto";

const SandboxSchema = z.object({
  sandbox: z.object({
    id: z.string(),
    state: z.string(),
    snapshotCompletedAt: z.string().nullable().optional(),
  }),
});
const HostedSchema = z.object({
  url: z.string().url(),
  isProtected: z.literal(true),
});

// A single operator-provisioned sandbox. Model inputs cannot select a machine,
// execute Boat commands, create billable VMs, or read the service credential.
export class BoatClient {
  constructor(private readonly env: Env) {}

  private async api(
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
  ) {
    if (
      !/^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(
        this.env.BOAT_SANDBOX_ID,
      )
    )
      throw new Error("Boat pilot is not configured");
    const response = await fetch(
      `https://boat.dev/api/v1/sandboxes/${this.env.BOAT_SANDBOX_ID}${path}`,
      {
        ...(method === "GET"
          ? { method }
          : { method, body: JSON.stringify(body) }),
        redirect: "error",
        headers: {
          Authorization: `Bearer ${await readSecret(this.env.BOAT_API_KEY)}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    // Provider bodies and hosted URLs may carry secrets; never reflect them.
    if (!response.ok)
      throw new Error(`Boat control request failed (${response.status})`);
    return response.json();
  }
  async info() {
    const { sandbox } = SandboxSchema.parse(await this.api("", "GET"));
    if (sandbox.id !== this.env.BOAT_SANDBOX_ID)
      throw new Error("Boat identity mismatch");
    return sandbox;
  }
  async resume() {
    await this.api("/resume", "POST", { ttlSeconds: 7200, noEnv: true });
  }
  async extend() {
    await this.api("", "PATCH", { ttlSeconds: 7200 });
  }
  async stop() {
    await this.api("/stop", "POST", { force: false });
  }
  async endpoint() {
    const { url } = HostedSchema.parse(
      await this.api("/host", "POST", { port: 8789 }),
    );
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".on.boat.dev") ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Unexpected Boat bridge address");
    return url;
  }
  async bridge(endpoint: string, path: string, body?: unknown) {
    const url = new URL(endpoint);
    url.pathname = path; // Preserve Boat's private port token, never log the URL.
    return fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${await readSecret(this.env.BOAT_BRIDGE_TOKEN)}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path === "/step" ? 180_000 : 20_000),
    });
  }
}
