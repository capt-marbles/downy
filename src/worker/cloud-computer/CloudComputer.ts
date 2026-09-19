import { DurableObject } from "cloudflare:workers";
import {
  getWorkspace,
  withWorkspace,
  type DurableObjectStorageLike,
  type WorkspaceOptions,
} from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer,
  type IWorkspaceContainerAPI,
} from "@cloudflare/computer/backends/container";
import { readSecret } from "../credentials/crypto";
import { AUTH_CHECKPOINT_KEY, saveAccountCheckpoint } from "./auth-checkpoint";
import {
  ComputerStatusSchema,
  LoginSchema,
  StepInputSchema,
  StepResultSchema,
} from "./protocol";

class ComputerBase extends withWorkspaceContainer(
  class extends DurableObject {},
) {
  readonly backend: CloudflareContainerBackend = new CloudflareContainerBackend(
    {
      // Preview SDK uses an older Fetcher type; only its HTTP methods are used.
      container: () => ({
        getWorkspaceContainer: () =>
          // eslint-disable-next-line typescript/no-unsafe-type-assertion -- preview SDK Fetcher lacks unrelated queue methods; HTTP interface is identical.
          this.getWorkspaceContainer() as unknown as IWorkspaceContainerAPI,
      }),
      workspace: { binding: "CloudComputer", id: this.ctx.id.toString() },
      egress: { mode: "direct" },
      restartAttempts: 1,
    },
  );
  options(): WorkspaceOptions {
    return {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- SDK documents this SQLite storage bridge; only row type variance differs.
      storage: this.ctx.storage as unknown as DurableObjectStorageLike,
      backends: [this.backend],
    };
  }
}

export class CloudComputer extends withWorkspace(ComputerBase, (self) =>
  self.options(),
) {
  #ready: Promise<void> | undefined;
  #busy = false;
  #state:
    | "sleeping"
    | "starting"
    | "ready"
    | "running"
    | "interrupted"
    | "error" = "sleeping";
  #authenticated = false;
  #loginPending = false;
  #idleAt = Date.now() + 15 * 60_000;
  #tail: Promise<void> = Promise.resolve();
  #queued = 0;
  #checkpointTail: Promise<void> = Promise.resolve();
  #error: string | null = null;
  #updatedAt = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<{
        authenticated: boolean;
        active: boolean;
        loginPending?: boolean;
        idleAt?: number;
      }>("computer-status");
      this.#authenticated = stored?.authenticated ?? false;
      this.#loginPending = stored?.loginPending ?? false;
      this.#idleAt = stored?.idleAt ?? this.#idleAt;
      if (stored?.active)
        this.#setState(
          "interrupted",
          "The previous inference was interrupted. Downy's recorded tool results are preserved.",
        );
    });
  }
  #persistStatus() {
    this.ctx.waitUntil(
      this.ctx.storage.put("computer-status", {
        authenticated: this.#authenticated,
        active: this.#state === "running",
        loginPending: this.#loginPending,
        idleAt: this.#idleAt,
      }),
    );
  }

  #setState(
    state:
      | "sleeping"
      | "starting"
      | "ready"
      | "running"
      | "interrupted"
      | "error",
    error: string | null = null,
  ) {
    this.#state = state;
    this.#error = error;
    this.#updatedAt = Date.now();
    this.#persistStatus();
  }
  async #port(path: string, body?: unknown): Promise<Response> {
    return this.getWorkspaceContainer().fetchPort(
      8789,
      new Request(`http://bridge${path}`, {
        method: body === undefined ? "GET" : "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(path === "/step" ? 180_000 : 20_000),
      }),
    );
  }
  async #ensureReady() {
    const runtime = await this.getWorkspaceContainer().status();
    if (!runtime.running) this.#ready = undefined;
    this.#ready ??= (async () => {
      this.#setState("starting");
      const workspace = await getWorkspace(this);
      // This is a fixed readiness probe, never an agent-provided command.
      const probe = await workspace.runtime.exec("/bin/true", {
        encoding: "utf8",
        timeoutMs: 30_000,
      });
      const probeResult = await probe.result();
      if (probeResult.exitCode !== 0)
        throw new Error("Computer readiness probe failed");
      let bridgeReady = false;
      try {
        bridgeReady = (await this.#port("/health")).ok;
      } catch {
        /* first boot */
      }
      if (!bridgeReady) {
        // Launch through Computer so its filesystem shim also works in local
        // development; on Cloudflare the same paths are backed by real FUSE.
        await workspace.runtime.exec("node /opt/downy/server.mjs", {
          encoding: "utf8",
          timeoutMs: 0,
        });
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            bridgeReady = (await this.#port("/health")).ok;
          } catch {
            /* process starting */
          }
          if (bridgeReady) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!bridgeReady) throw new Error("Codex bridge did not become ready");
      const response = await this.#port("/initialize", {
        key: await readSecret(this.env.CREDENTIAL_KEY),
        checkpoint: await this.ctx.storage.get(AUTH_CHECKPOINT_KEY),
      });
      if (!response.ok)
        throw new Error("Cloud computer initialization failed.");
      await this.getWorkspaceContainer().setInactivityTimeout(30 * 60_000);
      await this.#syncAccount();
      this.#setState("ready");
    })().catch((error: unknown) => {
      console.error("[cloud-computer] startup failed", {
        type: error instanceof Error ? error.name : "unknown",
      });
      this.#ready = undefined;
      this.#setState(
        "error",
        "Could not start cloud computer. Retry when available.",
      );
      throw error;
    });
    await this.#ready;
  }
  #syncAccount(): Promise<void> {
    const operation = this.#checkpointTail.then(async () => {
      const response = await this.#port("/account");
      if (!response.ok)
        throw new Error("Could not checkpoint cloud computer login");
      const authenticated = await saveAccountCheckpoint(
        this.ctx.storage,
        await response.json(),
      );
      this.#authenticated = authenticated;
      if (authenticated) this.#loginPending = false;
    });
    this.#checkpointTail = operation.catch(() => {});
    return operation;
  }
  async #status() {
    const running = (await this.getWorkspaceContainer().status()).running;
    if (
      !running &&
      this.#state !== "starting" &&
      this.#state !== "interrupted" &&
      this.#state !== "sleeping" &&
      this.#state !== "error"
    ) {
      this.#ready = undefined;
      this.#setState(this.#busy ? "interrupted" : "sleeping");
    }
    if (running && !this.#busy && this.#loginPending) {
      try {
        await this.#syncAccount();
        this.#persistStatus();
      } catch {
        this.#setState("error", "Cloud computer is temporarily unreachable.");
      }
    }
    const credentialCheckpoint = (await this.ctx.storage.get(
      AUTH_CHECKPOINT_KEY,
    ))
      ? "present"
      : "missing";
    return ComputerStatusSchema.parse({
      configured: true,
      state: this.#state,
      authenticated: this.#authenticated,
      error: this.#error,
      updatedAt: this.#updatedAt,
      model: this.env.DOWNY_CODEX_MODEL,
      credentialCheckpoint,
    });
  }
  override async alarm(): Promise<void> {
    // Computer's RPC heartbeat is transport activity, not user work. Enforce
    // idle sleep ourselves so that heartbeat cannot keep compute billed forever.
    if (this.#busy || this.#queued > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 3 * 60_000);
      return;
    }
    // Use the same queue as model work so a request cannot start while an
    // awaited checkpoint is followed by container destruction.
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#busy = true;
    try {
      if (this.ctx.container?.running) {
        try {
          await this.#syncAccount();
          this.#persistStatus();
        } catch {
          this.#setState(
            "error",
            "Could not save ChatGPT login. Keeping the computer awake; retrying shortly.",
          );
          await this.ctx.storage.setAlarm(Date.now() + 60_000);
          return;
        }
        if (Date.now() < this.#idleAt) {
          await this.ctx.storage.setAlarm(
            this.#loginPending ? Date.now() + 10_000 : this.#idleAt,
          );
          return;
        }
        await this.ctx.container.destroy();
      }
      this.#ready = undefined;
      this.#setState("sleeping");
    } finally {
      this.#busy = false;
      release();
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    // The computer's FUSE/RPC connection is internal and remains available
    // while a model step is running; do not blockConcurrencyWhile over inference.
    if (path === "/api" || path === "/health")
      return this.backend.handleFetch(request);
    if (path === "/status" && request.method === "GET")
      return Response.json(await this.#status());
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (!["/wake", "/login", "/step", "/restart"].includes(path))
      return new Response("Not found", { status: 404 });
    if ((path !== "/step" && this.#busy) || this.#queued >= 8)
      return Response.json(
        { error: "Cloud computer is busy. Try again shortly." },
        { status: 409 },
      );
    // Serialize this personal account without blocking the FUSE callbacks or
    // status polling. Different Downy agents retain separate prompt/tool sets.
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#queued++;
    await previous;
    this.#queued--;
    this.#busy = true;
    try {
      if (path === "/restart") {
        // A stop proves auth survives an actual fresh container disk. Auth is
        // encrypted in the computer VFS, not in its disposable root filesystem.
        if (this.ctx.container?.running) {
          await this.#ensureReady();
          await this.#syncAccount();
          await this.ctx.container.destroy();
        }
        this.#ready = undefined;
      }
      await this.#ensureReady();
      if (path === "/wake" || path === "/restart")
        return Response.json({ ready: true });
      if (path === "/login") {
        const response = await this.#port("/login", {});
        if (!response.ok) throw new Error("Login unavailable");
        this.#loginPending = true;
        return Response.json(LoginSchema.parse(await response.json()), {
          headers: { "Cache-Control": "no-store" },
        });
      }
      const input = StepInputSchema.parse(await request.json());
      this.#setState("running");
      const response = await this.#port("/step", input);
      if (response.status === 401) {
        this.#authenticated = false;
        this.#setState(
          "ready",
          "Reconnect ChatGPT in Settings. Your work is preserved.",
        );
        return Response.json({ error: "Reconnect ChatGPT" }, { status: 401 });
      }
      if (response.status === 429) {
        this.#setState(
          "ready",
          "ChatGPT usage limit reached. Try again after your allowance resets; no paid fallback was used.",
        );
        return Response.json({ error: this.#error }, { status: 429 });
      }
      if (!response.ok) throw new Error("Step failed");
      const result = StepResultSchema.parse(await response.json());
      await this.#syncAccount();
      this.#setState("ready");
      return Response.json(result);
    } catch (error) {
      this.#ready = undefined;
      console.error("[cloud-computer] operation failed", {
        type: error instanceof Error ? error.name : "unknown",
      });
      this.#setState(
        "error",
        "Cloud computer stopped before completing the step. No paid fallback was used.",
      );
      return Response.json({ error: this.#error }, { status: 503 });
    } finally {
      this.#busy = false;
      release();
      this.#idleAt = Date.now() + 15 * 60_000;
      this.#persistStatus();
      await this.ctx.storage.setAlarm(
        this.#loginPending ? Date.now() + 10_000 : this.#idleAt,
      );
    }
  }
}
