import type { GmailAction } from "../../lib/gmail-connect";
import { GmailConnection, GmailStateSchema, type GmailState } from "./gmail";
import { z } from "zod";
import {
  encryptHeaders,
  decryptHeaders,
  readSecret,
  type CredentialEnvelope,
  type SecretBinding,
} from "../credentials/crypto";
import type { ComposioOAuthStatus } from "../../lib/composio-oauth";

const RESOURCE = "https://connect.composio.dev/mcp";
const ISSUER = "https://connect.composio.dev";
const KEY = "composio-oauth:v1";
const TTL = 15 * 60_000;
const OAuthSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string().url(),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  pending: z
    .object({
      state: z.string(),
      verifier: z.string(),
      url: z.string().url(),
      expiresAt: z.number(),
      agentSlug: z.string(),
    })
    .optional(),
  tokens: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.number(),
    })
    .optional(),
  gmail: GmailStateSchema.optional(),
  status: z.enum([
    "disconnected",
    "authorizing",
    "connected",
    "expired",
    "failed",
    "needs_reconnect",
  ]),
  connectedAt: z.number().nullable(),
  checkedAt: z.number().nullable(),
});
type Stored = z.infer<typeof OAuthSchema>;
type Store = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};
const encoded = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const random = () => encoded(crypto.getRandomValues(new Uint8Array(32)));
const trusted = (value: string) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["connect.composio.dev", "login.composio.dev"].includes(url.hostname)
  )
    throw new Error("Unexpected OAuth endpoint");
  return url.toString();
};

function sseResult(events: string[]): unknown {
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    const parsed = z
      .object({
        id: z.number().optional(),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      })
      .parse(JSON.parse(data));
    if (parsed.id !== 1) continue;
    if (parsed.error || !parsed.result)
      throw new Error("MCP verification failed");
    return parsed.result;
  }
  return undefined;
}

/** Per-Access-user state, kept in an internal DO. No token-bearing value is
 * returned by the public status API, agent tools, chat receipts or logs. */
export class ComposioOAuth {
  constructor(
    private readonly store: Store,
    private readonly key: SecretBinding,
    private readonly owner: string,
    private readonly request: typeof fetch = (input, init) =>
      fetch(input, init),
    private readonly now = Date.now,
  ) {}
  private async load(): Promise<Stored | null> {
    const saved = await this.store.get<CredentialEnvelope>(KEY);
    if (!saved) return null;
    const plain = await decryptHeaders(
      saved,
      await readSecret(this.key),
      this.owner,
    );
    return OAuthSchema.parse(JSON.parse(plain.data));
  }
  private async save(data: Stored) {
    await this.store.put(
      KEY,
      await encryptHeaders(
        { data: JSON.stringify(data) },
        await readSecret(this.key),
        this.owner,
      ),
    );
  }
  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.request(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn("Composio OAuth provider response", {
        status: response.status,
      });
      throw new Error("OAuth provider request failed");
    }
    return response.json();
  }
  private async step<T>(stage: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      // Fixed stage labels only: provider payloads, codes and tokens never log.
      console.warn("Composio OAuth setup failed", {
        stage,
        type:
          error instanceof TypeError
            ? error.message.includes("redirect")
              ? "redirect-mode"
              : error.message.includes("Illegal invocation")
                ? "fetch-receiver"
                : "network"
            : error instanceof SyntaxError
              ? "response-format"
              : "request",
      });
      // eslint-disable-next-line preserve-caught-error -- provider errors may contain tokens; never cross the RPC boundary.
      throw new Error("Composio OAuth setup failed");
    }
  }
  async start(origin: string, agentSlug: string): Promise<string> {
    // The request handler supplies its own origin, never a caller return URL.
    const redirectUri = `${origin}/api/composio/oauth/callback`;
    let stored = await this.step("load", () => this.load());
    if (
      stored?.pending &&
      stored.pending.expiresAt > this.now() &&
      stored.redirectUri === redirectUri
    )
      return stored.pending.url;
    if (!stored || stored.redirectUri !== redirectUri) {
      const resource = z
        .object({
          resource: z.literal(RESOURCE),
          authorization_servers: z.array(z.string()),
        })
        .parse(
          await this.step("resource-discovery", () =>
            this.json(`${ISSUER}/.well-known/oauth-protected-resource`),
          ),
        );
      if (!resource.authorization_servers.includes(ISSUER))
        throw new Error("Unexpected OAuth issuer");
      const metadata = z
        .object({
          issuer: z.literal(ISSUER),
          authorization_endpoint: z.string().url(),
          token_endpoint: z.string().url(),
          registration_endpoint: z.string().url(),
          code_challenge_methods_supported: z.array(z.string()),
          token_endpoint_auth_methods_supported: z.array(z.string()),
        })
        .parse(
          await this.step("authorization-discovery", () =>
            this.json(`${ISSUER}/.well-known/oauth-authorization-server`),
          ),
        );
      if (
        !metadata.code_challenge_methods_supported.includes("S256") ||
        !metadata.token_endpoint_auth_methods_supported.includes("none")
      )
        throw new Error("Required PKCE support unavailable");
      const client = z.object({ client_id: z.string().min(1) }).parse(
        await this.step("client-registration", () =>
          this.json(trusted(metadata.registration_endpoint), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_name: "Downy",
              redirect_uris: [redirectUri],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            }),
          }),
        ),
      );
      stored = {
        clientId: client.client_id,
        redirectUri,
        authorizationEndpoint: trusted(metadata.authorization_endpoint),
        tokenEndpoint: trusted(metadata.token_endpoint),
        status: "disconnected",
        connectedAt: null,
        checkedAt: null,
      };
    }
    const verifier = random();
    const state = random();
    const challenge = encoded(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    );
    const authorization = new URL(stored.authorizationEndpoint);
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: stored.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
      scope: "openid profile email offline_access",
    }).toString();
    stored.pending = {
      state,
      verifier,
      url: authorization.toString(),
      expiresAt: this.now() + TTL,
      agentSlug,
    };
    stored.status = "authorizing";
    const pending = stored;
    await this.step("save", () => this.save(pending));
    return authorization.toString();
  }
  private async exchange(stored: Stored, parameters: Record<string, string>) {
    const body = new URLSearchParams({
      client_id: stored.clientId,
      resource: RESOURCE,
      ...parameters,
    });
    const result = z
      .object({
        access_token: z.string().min(1),
        token_type: z
          .string()
          .refine((value) => value.toLowerCase() === "bearer"),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
      })
      .parse(
        await this.json(stored.tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        }),
      );
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? stored.tokens?.refreshToken,
      expiresAt: this.now() + result.expires_in * 1000,
    };
  }
  async complete(
    state: string,
    code: string | null,
    denied: boolean,
  ): Promise<{ agentSlug: string; state: "connected" | "failed" }> {
    const stored = await this.load();
    const pending = stored?.pending;
    if (
      !stored ||
      !pending ||
      pending.state !== state ||
      pending.expiresAt <= this.now()
    )
      throw new Error("Authorization session is invalid or expired");
    // Consume before exchange: duplicate callbacks never redeem a code twice.
    delete stored.pending;
    stored.status = "failed";
    await this.save(stored);
    if (denied || !code)
      return { agentSlug: pending.agentSlug, state: "failed" };
    try {
      stored.tokens = await this.exchange(stored, {
        grant_type: "authorization_code",
        code,
        redirect_uri: stored.redirectUri,
        code_verifier: pending.verifier,
      });
      await this.save(stored);
      await this.verify(stored.tokens.accessToken);
      stored.status = "connected";
      stored.connectedAt = this.now();
      stored.checkedAt = this.now();
      await this.save(stored);
      return { agentSlug: pending.agentSlug, state: "connected" };
    } catch {
      // Never echo an OAuth response, thrown provider error, code or token.
      await this.save(stored);
      return { agentSlug: pending.agentSlug, state: "failed" };
    }
  }
  async status(): Promise<ComposioOAuthStatus> {
    const stored = await this.load();
    if (!stored)
      return {
        state: "disconnected",
        connectedAt: null,
        checkedAt: null,
        expiresAt: null,
        error: null,
      };
    if (stored.pending && stored.pending.expiresAt <= this.now()) {
      delete stored.pending;
      stored.status = "expired";
      await this.save(stored);
    }
    if (
      stored.status === "connected" &&
      stored.tokens &&
      stored.tokens.expiresAt <= this.now() + 60_000
    ) {
      try {
        if (!stored.tokens.refreshToken) throw new Error("Reconnect required");
        stored.tokens = await this.exchange(stored, {
          grant_type: "refresh_token",
          refresh_token: stored.tokens.refreshToken,
        });
        await this.verify(stored.tokens.accessToken);
        stored.checkedAt = this.now();
      } catch {
        stored.status = "needs_reconnect";
      }
      await this.save(stored);
    }
    return {
      state: stored.status,
      connectedAt: stored.connectedAt,
      checkedAt: stored.checkedAt,
      expiresAt: stored.pending?.expiresAt ?? null,
      error:
        stored.status === "failed"
          ? "Composio connection failed. Please try again."
          : stored.status === "needs_reconnect"
            ? "Please reconnect Composio."
            : stored.status === "expired"
              ? "Sign-in expired. Please connect again."
              : null,
    };
  }
  async disconnect(): Promise<void> {
    await this.store.delete(KEY);
  }
  private async rpc(
    token: string,
    method: string,
    params: unknown,
    sessionId?: string,
    protocol = "2025-03-26",
  ): Promise<{ result: unknown; sessionId?: string }> {
    const response = await this.request(RESOURCE, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol,
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error("Composio verification failed");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty MCP response");
    const decoder = new TextDecoder();
    let text = "";
    let received = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        text += decoder.decode(value, { stream: !done });
        received += value?.byteLength ?? 0;
        if (received > 1_000_000) throw new Error("MCP response too large");
        const sse = response.headers
          .get("content-type")
          ?.includes("text/event-stream");
        if (sse) {
          const events = text.split(/\r?\n\r?\n/);
          text = events.pop() ?? "";
          const result = sseResult(events);
          if (result !== undefined)
            return {
              result,
              sessionId: response.headers.get("mcp-session-id") ?? sessionId,
            };
        } else if (done) {
          const parsed = z
            .object({ result: z.unknown(), error: z.unknown().optional() })
            .parse(JSON.parse(text));
          if (parsed.error || !parsed.result)
            throw new Error("MCP verification failed");
          return {
            result: parsed.result,
            sessionId: response.headers.get("mcp-session-id") ?? sessionId,
          };
        }
        if (done) throw new Error("Incomplete MCP response");
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  private async openSession(token: string) {
    const init = await this.rpc(token, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Downy", version: "1" },
    });
    // Discovery verifies the connection but does not register broad execution or
    // workbench tools with the model. Gmail grants remain a separate step.
    const { protocolVersion } = z
      .object({
        protocolVersion: z.enum(["2025-03-26", "2025-06-18", "2025-11-25"]),
      })
      .parse(init.result);
    const initialized = await this.request(RESOURCE, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": protocolVersion,
        ...(init.sessionId ? { "Mcp-Session-Id": init.sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    await initialized.body?.cancel();
    if (!initialized.ok) throw new Error("Composio initialization failed");
    return { sessionId: init.sessionId, protocolVersion };
  }
  private async verify(token: string) {
    const session = await this.openSession(token);
    const tools = await this.rpc(
      token,
      "tools/list",
      {},
      session.sessionId,
      session.protocolVersion,
    );
    z.object({ tools: z.array(z.object({ name: z.string() })).min(1) }).parse(
      tools.result,
    );
  }
  private gmail() {
    return new GmailConnection(
      async (name, args) => {
        if ((await this.status()).state !== "connected")
          throw new Error("Connect Composio first");
        const token = (await this.load())?.tokens?.accessToken;
        if (!token) throw new Error("Connect Composio first");
        const session = await this.openSession(token);
        return (
          await this.rpc(
            token,
            "tools/call",
            { name, arguments: args },
            session.sessionId,
            session.protocolVersion,
          )
        ).result;
      },
      async () => (await this.load())?.gmail,
      async (gmail: GmailState) => {
        const stored = await this.load();
        if (!stored) throw new Error("Connect Composio first");
        stored.gmail = gmail;
        await this.save(stored);
      },
      this.now,
    );
  }
  async gmailStatus(refresh = false) {
    if ((await this.status()).state !== "connected")
      return {
        state: "needs_composio" as const,
        email: null,
        checkedAt: null,
        error: null,
        authorized: false,
      };
    return this.gmail().status(refresh);
  }
  async startGmail() {
    return this.gmail().start();
  }
  async gmailAction(input: GmailAction) {
    return this.gmail().action(input);
  }
}
