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
  private session:
    | { endpoint: string; cookie: string; expiresAt: number }
    | undefined;
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
    const apiKey = await readSecret(this.env.BOAT_API_KEY);
    const response = await fetch(
      `https://boat.dev/api/v1/sandboxes/${this.env.BOAT_SANDBOX_ID}${path}`,
      {
        ...(method === "GET"
          ? { method }
          : { method, body: JSON.stringify(body) }),
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
    if (
      !this.session ||
      this.session.endpoint !== endpoint ||
      Date.now() >= this.session.expiresAt
    ) {
      // Boat's port gate consumes _token with a 302 and sets a cookie. Resolve
      // that handshake using GET without bridge credentials or a request body;
      // never automatically redirect a credential bootstrap or model request.
      url.pathname = "/health";
      const handshake = await fetch(new URL(url), {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const location = handshake.headers.get("location");
      const cookie = handshake.headers.get("set-cookie")?.split(";")[0];
      await handshake.body?.cancel();
      if (
        ![302, 303].includes(handshake.status) ||
        !location ||
        new URL(location, url).origin !== url.origin ||
        !cookie ||
        !/^[a-zA-Z0-9_-]+=[^\s;,]+$/.test(cookie)
      )
        throw new Error("Boat private gateway handshake failed");
      this.session = { endpoint, cookie, expiresAt: Date.now() + 5 * 60_000 };
    }
    url.pathname = path;
    url.searchParams.delete("_token");
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Cookie: this.session.cookie,
        Authorization: `Bearer ${await readSecret(this.env.BOAT_BRIDGE_TOKEN)}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path === "/step" ? 180_000 : 20_000),
    });
    // Workers only support follow/manual; reject redirects without forwarding
    // the independent bridge credential or any model/bootstrap request body.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Unexpected Boat bridge redirect");
    }
    return response;
  }
}
