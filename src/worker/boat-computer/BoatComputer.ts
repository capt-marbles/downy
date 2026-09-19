import { DurableObject } from "cloudflare:workers";
import {
  ComputerStatusSchema,
  LoginSchema,
  StepInputSchema,
  StepResultSchema,
} from "../cloud-computer/protocol";
import {
  AUTH_CHECKPOINT_KEY,
  saveAccountCheckpoint,
} from "../cloud-computer/auth-checkpoint";
import { readSecret } from "../credentials/crypto";
import { BoatClient } from "./client";

type State =
  | "sleeping"
  | "starting"
  | "ready"
  | "running"
  | "interrupted"
  | "error";
type Saved = {
  state: State;
  authenticated: boolean;
  loginPending: boolean;
  idleAt: number;
  updatedAt: number;
  error: string | null;
};
const IDLE_MS = 15 * 60_000;
function diagnostic(error: unknown) {
  const type = error instanceof Error ? error.name : "unknown";
  const status =
    error instanceof Error
      ? /^Boat control request failed \((\d{3})\)$/.exec(error.message)?.[1]
      : undefined;
  // Bounded fields only: never provider payloads, URLs, headers, or auth state.
  console.error("[boat-computer] operation failed", { type, status });
}

export class BoatComputer extends DurableObject {
  private client: BoatClient;
  private endpoint: string | undefined;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private checkedAt = 0;
  private saved: Saved = {
    state: "sleeping",
    authenticated: false,
    loginPending: false,
    idleAt: 0,
    updatedAt: Date.now(),
    error: null,
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.client = new BoatClient(env);
    void ctx.blockConcurrencyWhile(async () => {
      this.saved = (await ctx.storage.get<Saved>("boat-status")) ?? this.saved;
      if (this.saved.state === "running") {
        this.saved.state = "interrupted";
        this.saved.error =
          "The previous inference was interrupted. Downy's recorded results are preserved.";
      }
    });
  }
  private async state(state: State, error: string | null = null) {
    this.saved = { ...this.saved, state, error, updatedAt: Date.now() };
    await this.ctx.storage.put("boat-status", this.saved);
  }
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queued >= 8) throw new Error("Boat queue is full");
    this.queued++;
    const operation = this.tail.then(fn);
    this.tail = operation.then(
      () => {},
      () => {},
    );
    try {
      return await operation;
    } finally {
      this.queued--;
    }
  }
  private async port(path: string, body?: unknown) {
    if (!this.endpoint) throw new Error("Boat bridge is not ready");
    return this.client.bridge(this.endpoint, path, body);
  }
  private async checkpoint() {
    const response = await this.port("/account");
    if (!response.ok) throw new Error("Could not save Boat login");
    this.saved.authenticated = await saveAccountCheckpoint(
      this.ctx.storage,
      await response.json(),
    );
    if (this.saved.authenticated) this.saved.loginPending = false;
    await this.ctx.storage.put("boat-status", this.saved);
  }
  private async waitFor(target: "awake" | "archived") {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const info = await this.client.info();
      if (
        target === "archived"
          ? info.state === "archived"
          : ["ready", "idle", "running"].includes(info.state)
      )
        return;
      if (info.state === "error") throw new Error("Boat runtime failed");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Boat lifecycle timed out");
  }
  private async ready() {
    await this.state("starting");
    const info = await this.client.info();
    if (info.state === "archiving") await this.waitFor("archived");
    if (["archiving", "archived"].includes(info.state))
      await this.client.resume();
    else await this.client.extend();
    await this.waitFor("awake");
    this.endpoint = await this.client.endpoint();
    // The same restricted bridge as CF: no Boat /prompt, shell, browser or MCP
    // execution. Only Downy may execute the yielded tool calls and their gates.
    const deadline = Date.now() + 60_000;
    let initialized = false;
    while (Date.now() < deadline) {
      try {
        const response = await this.port("/initialize", {
          key: await readSecret(this.env.BOAT_CREDENTIAL_KEY),
          checkpoint: await this.ctx.storage.get(AUTH_CHECKPOINT_KEY),
        });
        initialized = response.ok;
        await response.body?.cancel();
      } catch {
        /* systemd and restored files may still be starting */
      }
      if (initialized) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!initialized) throw new Error("Boat bridge did not become ready");
    await this.checkpoint();
    await this.state("ready");
  }
  private async sleep() {
    const info = await this.client.info();
    if (info.state !== "archived" && info.state !== "archiving") {
      if (!this.endpoint) await this.ready();
      await this.checkpoint(); // No forced stop after a failed credential save.
      await this.client.stop();
    }
    await this.waitFor("archived");
    this.endpoint = undefined;
    await this.state("sleeping");
  }
  override async alarm() {
    if (this.queued) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }
    await this.serial(async () => {
      try {
        if ((await this.client.info()).state === "archived") {
          this.endpoint = undefined;
          this.saved.loginPending = false;
          await this.state("sleeping");
          await this.ctx.storage.deleteAlarm();
          return;
        }
        if (Date.now() >= this.saved.idleAt) await this.sleep();
        else {
          if (!this.endpoint) await this.ready();
          await this.checkpoint();
          await this.ctx.storage.setAlarm(
            this.saved.loginPending ? Date.now() + 10_000 : this.saved.idleAt,
          );
        }
      } catch (error) {
        diagnostic(error);
        await this.state(
          "error",
          "Boat could not save or stop cleanly. Retrying; the two-hour runtime limit remains in force.",
        );
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      }
    });
  }
  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/status" && request.method === "GET") {
      // Polling the UI never wakes a sandbox or resets its idle timer.
      if (
        this.env.BOAT_SANDBOX_ID &&
        !this.queued &&
        Date.now() - this.checkedAt > 10_000
      ) {
        this.checkedAt = Date.now();
        try {
          const info = await this.client.info();
          // A model/lifecycle request may have started while the read was pending.
          if (!this.queued && info.state === "archived") {
            this.endpoint = undefined;
            await this.state("sleeping");
          } else if (!this.queued && info.state === "error") {
            await this.state(
              "error",
              "Boat reports a runtime error. Wake the pilot to retry.",
            );
          }
        } catch (error) {
          diagnostic(error);
          if (!this.queued)
            await this.state("error", "Could not verify Boat runtime status.");
        }
      }
      return Response.json(
        ComputerStatusSchema.parse({
          configured: Boolean(this.env.BOAT_SANDBOX_ID),
          ...this.saved,
          credentialCheckpoint: (await this.ctx.storage.get(
            AUTH_CHECKPOINT_KEY,
          ))
            ? "present"
            : "missing",
          model: this.env.DOWNY_CODEX_MODEL,
        }),
      );
    }
    if (
      request.method !== "POST" ||
      !["/wake", "/login", "/step", "/sleep", "/restart"].includes(path)
    )
      return new Response("Not found", { status: 404 });
    if ((path !== "/step" && this.queued) || this.queued >= 8)
      return Response.json({ error: "Boat is busy" }, { status: 409 });
    // Validate before waking/billing the machine.
    const input =
      path === "/step"
        ? StepInputSchema.safeParse(await request.json())
        : undefined;
    if (input && !input.success)
      return Response.json({ error: "Invalid step" }, { status: 400 });
    return this.serial(async () => {
      try {
        if (path === "/sleep" || path === "/restart") {
          await this.sleep();
          if (path === "/sleep") return Response.json({ sleeping: true });
        }
        await this.ready();
        if (path === "/login") {
          const response = await this.port("/login", {});
          if (!response.ok) throw new Error("Login unavailable");
          this.saved.loginPending = true;
          return Response.json(LoginSchema.parse(await response.json()));
        }
        if (input?.success) {
          await this.state("running");
          const response = await this.port("/step", input.data);
          if (response.status === 401 || response.status === 429) {
            if (response.status === 401) this.saved.authenticated = false;
            await this.state(
              "ready",
              response.status === 401
                ? "Reconnect ChatGPT in the Boat pilot card."
                : "ChatGPT allowance reached; no paid fallback used.",
            );
            return Response.json(
              { error: this.saved.error },
              { status: response.status },
            );
          }
          if (!response.ok) throw new Error("Step failed");
          const result = StepResultSchema.parse(await response.json());
          await this.checkpoint();
          await this.state("ready");
          return Response.json(result);
        }
        return Response.json({ ready: true });
      } catch (error) {
        diagnostic(error);
        this.endpoint = undefined;
        await this.state(
          "error",
          "Boat could not complete this operation. Your Downy transcript is preserved; no fallback used.",
        );
        return Response.json({ error: this.saved.error }, { status: 503 });
      } finally {
        this.saved.idleAt = Date.now() + IDLE_MS;
        await this.ctx.storage.put("boat-status", this.saved);
        if (this.saved.state === "sleeping")
          await this.ctx.storage.deleteAlarm();
        else
          await this.ctx.storage.setAlarm(
            this.saved.loginPending ? Date.now() + 10_000 : this.saved.idleAt,
          );
      }
    });
  }
}
