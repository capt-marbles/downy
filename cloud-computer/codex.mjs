import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

// The only agent tools exposed by this service are Downy's dynamic tools.
// Credentials live outside cwd, no user config/skills are inherited, and all
// unexpected server requests / executable item types terminate the process.
const CONFIG = {
  forced_login_method: "chatgpt",
  cli_auth_credentials_store: "file",
  web_search: "disabled",
  project_doc_max_bytes: 0,
  features: {
    shell_tool: false,
    unified_exec: false,
    apps: false,
    browser_use: false,
    computer_use: false,
    code_mode: false,
    code_mode_host: false,
    multi_agent: false,
    multi_agent_v2: false,
    skill_search: false,
    shell_snapshot: false,
    skip_host_skill_discovery: true,
  },
  mcp_servers: {},
};
const SAFE_ITEMS = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "dynamicToolCall",
  "contextCompaction",
]);

function failure(info) {
  const codes =
    typeof info === "object" && info
      ? Object.values(info).map((value) => value?.httpStatusCode)
      : [];
  const status =
    info === "unauthorized" || codes.includes(401)
      ? 401
      : [
            "rateLimitExceeded",
            "usageLimitExceeded",
            "sessionBudgetExceeded",
          ].includes(info) || codes.includes(429)
        ? 429
        : 503;
  return Object.assign(new Error("Codex step failed"), { status });
}

export class CodexBridge {
  constructor(home, binary = "codex") {
    this.closed = false;
    this.pending = new Map();
    this.sequence = 0;
    this.active = null;
    this.child = spawn(binary, ["app-server"], {
      cwd: "/tmp",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: home,
        LANG: "C.UTF-8",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.fail();
      }
    });
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => {
      this.closed = true;
      this.fail();
    });
  }
  fail() {
    for (const pending of this.pending.values())
      pending.reject(new Error("Codex unavailable"));
    this.pending.clear();
    this.active?.reject(new Error("Codex step interrupted"));
    this.active = null;
  }
  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  rpc(method, params = {}, timeoutMs = 20_000) {
    if (this.closed) return Promise.reject(new Error("Codex unavailable"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex request timed out"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.rpc("initialize", {
      clientInfo: { name: "downy", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized" });
  }
  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error)
        pending?.reject(failure(message.error.data?.codexErrorInfo));
      else pending?.resolve(message.result);
      return;
    }
    const active = this.active;
    if (message.id !== undefined && message.method) {
      if (message.method !== "item/tool/call" || !active) {
        this.close();
        return;
      }
      const params = message.params;
      const name = active.names.get(params.tool);
      if (!name || params.threadId !== active.threadId) {
        this.close();
        return;
      }
      // Yield intent BEFORE execution. Downy's AI SDK loop owns the execution
      // and records its result. Never acknowledge a tool as executed here.
      active.resolve({
        text: active.text,
        toolCalls: [
          {
            id: randomUUID(),
            name,
            arguments: JSON.stringify(params.arguments),
          },
        ],
      });
      this.active = null;
      return;
    }
    if (!active || message.params?.threadId !== active.threadId) return;
    if (
      message.method === "item/started" &&
      !SAFE_ITEMS.has(message.params.item.type)
    ) {
      this.close();
      return;
    }
    if (message.method === "item/agentMessage/delta")
      active.text += message.params.delta;
    if (active.text.length > 80_000) {
      this.close();
      return;
    }
    if (message.method === "error")
      active.error = failure(message.params.error?.codexErrorInfo);
    if (message.method === "turn/completed") {
      if (message.params.turn.status !== "completed")
        active.reject(
          active.error ?? failure(message.params.turn.error?.codexErrorInfo),
        );
      else active.resolve({ text: active.text, toolCalls: [] });
      this.active = null;
    }
  }
  async account() {
    const result = await this.rpc("account/read", { refreshToken: false });
    return { authenticated: result.account?.type === "chatgpt" };
  }
  async login() {
    const result = await this.rpc("account/login/start", {
      type: "chatgptDeviceCode",
    });
    return {
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
    };
  }
  async step(input) {
    if (!(await this.account()).authenticated)
      throw Object.assign(new Error("Reconnect ChatGPT"), { status: 401 });
    const names = new Map(
      input.tools.map((tool, index) => [`downy_${index}`, tool.name]),
    );
    const thread = await this.rpc("thread/start", {
      model: input.model,
      modelProvider: "openai",
      allowProviderModelFallback: false,
      cwd: "/tmp",
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
      config: CONFIG,
      selectedCapabilityRoots: [],
      baseInstructions: input.system,
      developerInstructions:
        "You are the reasoning service for Downy. The supplied JSON is the authoritative conversation transcript, including actual tool results. Continue from its latest message. Use only the provided Downy tools. Return a final answer when the work is complete. Never claim a tool succeeded until its result is in the transcript.",
      dynamicTools: input.tools.map((tool, index) => ({
        type: "function",
        name: `downy_${index}`,
        description: `${tool.name}: ${tool.description}`,
        inputSchema: tool.inputSchema,
      })),
    });
    let timer;
    let turnId;
    try {
      const result = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Codex step timed out")),
          150_000,
        );
        this.active = {
          threadId: thread.thread.id,
          names,
          text: "",
          resolve,
          reject,
        };
      });
      // Attach a rejection handler before waiting for the start response.
      void result.catch(() => {});
      const turn = await this.rpc("turn/start", {
        threadId: thread.thread.id,
        input: [{ type: "text", text: input.transcript }],
      });
      turnId = turn.turn.id;
      return await result;
    } finally {
      clearTimeout(timer);
      this.active = null;
      if (turnId)
        await this.rpc("turn/interrupt", {
          threadId: thread.thread.id,
          turnId,
        }).catch(() => {});
      await this.rpc("thread/archive", { threadId: thread.thread.id }).catch(
        () => {},
      );
    }
  }
  close() {
    this.closed = true;
    this.fail();
    this.lines.close();
    this.child.kill("SIGKILL");
  }
}
