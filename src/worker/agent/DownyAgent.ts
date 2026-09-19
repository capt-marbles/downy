import { advanceCampaignWorkflow } from "../campaign-room/advance";
import {
  BrowserResearchSchema,
  browserResearchPath,
  browserResearchMarkdown,
} from "../../lib/browser-research";
import { voiceReadTools, voiceToolSet } from "../voice/policy";
import { voiceTurnOutcome, voiceOutcomeChatText } from "../voice/outcome";
import type { AdvanceWorkflowInput } from "../buildroom/workflows";
import { syncCorpus } from "../corpus/sync";
import { corpusRepos, type CorpusCursor } from "../corpus/types";
import { createFindToolSetupTool } from "./tools/tool-setup";
import { createRequestCredentialTool } from "./tools/credentials";
import {
  encryptHeaders,
  decryptHeaders,
  readSecret,
} from "../credentials/crypto";
import type { CredentialTarget, CredentialOutcome } from "../credentials/types";
import { connectMcpWithTriage } from "./mcp-connect";
import type { McpTransport } from "./mcp-triage";
import { readFetchBytes, uniqueInboxPath } from "../local-hands/upload";
/* eslint-disable max-lines -- central Durable Object agent class; split once Think lifecycle hooks settle. */
import { Think } from "@cloudflare/think";
import { getAgentByName } from "agents";
import { CHAT_MESSAGE_TYPES } from "agents/chat";
import { Workspace, type FileInfo } from "@cloudflare/shell";
import {
  generateText,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from "ai";
import type { Session } from "agents/experimental/memory/session";
import { createCompactFunction } from "agents/experimental/memory/utils";

import { ACTIVE_PLAN_KEY, buildSystemPrompt } from "./build-system-prompt";
import {
  isSyntheticUserMessage,
  parseSlugHeader,
} from "./background-task-utils";
import {
  assertChildWorkspaceCallAllowed,
  normalizeWorkspacePath,
} from "./child-workspace-rpc";
import type { ActivePlan } from "./tools/todo-write";
import { DEFAULT_AI_PROVIDER, getModelFor, readAiProvider } from "./get-model";
import {
  AGENT_CORE_FILES,
  BOOTSTRAP_PATH,
  BOOTSTRAP_SEED,
  coreFileMeta,
  IDENTITY_PATH,
  isAgentCorePath,
  isAgentManagedPath,
  isBootstrapPath,
  isCorePath,
  isProfileCorePath,
  resolveCoreFile,
  type CoreFileRecord,
} from "./core-files";
import { readUserFile } from "../db/profile";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  type BackgroundTaskRecord,
} from "./background-task-types";
import { ignoreClientCancels } from "./ignore-client-cancels";
import {
  createConnectCloudflareMcpServerTool,
  createConnectMcpServerTool,
  createDisconnectMcpServerTool,
  createListMcpServersTool,
} from "./tools/mcp-servers";
import {
  createReadUserProfileTool,
  createWriteUserProfileTool,
} from "./tools/user-profile";
import { listSkills } from "./skills/loader";
import { type SkillEntry } from "./skills/types";
import { createSpawnBackgroundTaskTool } from "./tools/spawn-background-task";
import {
  createDeleteScheduledTaskTool,
  createListScheduledTasksTool,
  createScheduleTaskTool,
  createUpdateScheduledTaskTool,
} from "./tools/scheduled-tasks";
import {
  createListCampaignSchedulePresetsTool,
  createScheduleCampaignRoomPresetTool,
} from "./tools/campaign-schedules";
import {
  createReadCampaignArtifactTool,
  createWriteCampaignArtifactTool,
} from "./tools/campaign-room";
import {
  createBuildroomJobTool,
  createListBuildroomJobsTool,
} from "./tools/buildroom";
import {
  createAdvanceBuildroomWorkflowTool,
  createCreateBuildroomWorkflowTemplateTool,
  createGetBuildroomWorkflowTool,
  createListBuildroomWorkflowTemplatesTool,
  createRecordBuildroomGateDecisionTool,
  createStartBuildroomWorkflowTool,
} from "./tools/buildroom-workflows";
import * as toolRegistry from "./tool-registry";

import {
  createConfirmLocalHandsActionTool,
  createListLocalHandsActionsTool,
  createRequestGrokResearchTool,
  createRequestLocalHandsActionTool,
} from "./tools/local-hands";
import {
  callMcpToolViaParent,
  isReconnectableMcpError,
  listMcpToolDescriptors,
  type McpToolDescriptor,
} from "./mcp-proxy";
import {
  EMPTY_MODEL_USAGE,
  MODEL_TURN_DIAGNOSTIC_KEY,
  MODEL_USAGE_KEY,
  buildModelStatus,
  parseUsage,
  type ModelStatus,
  type ModelTokenUsage,
  type ModelTurnDiagnostic,
} from "./model-status";
import {
  rebuildMcpServer,
  restoreHeaderAuthServer,
  type StoredMcpServer,
} from "./mcp-reconnect";
import { getAgent, listAgents } from "../db/profile";
import { readBuildroomArtifact } from "../buildroom/artifacts";
import {
  readCampaignArtifact as readCampaignArtifactFile,
  writeCampaignArtifact as writeCampaignArtifactFile,
} from "../campaign-room/artifacts";
import { getBuildroomJob, listBuildroomEvents } from "../buildroom/db";
import type {
  BuildroomArtifact,
  BuildroomArtifactName,
} from "../buildroom/schemas";
import type {
  CampaignArtifact,
  CampaignArtifactName,
} from "../campaign-room/schemas";

const BOOTSTRAP_SEEDED_KEY = "downy:bootstrap-seeded";

const backgroundTaskKey = (id: string) => `background_task:${id}`;
const MCP_SERVER_KEY_PREFIX = "mcp_server:";
const mcpServerKey = (id: string) => `${MCP_SERVER_KEY_PREFIX}${id}`;
const mcpServerIdentityKey = (name: string, url: string) => `${name}\n${url}`;

type AssistantMessageState = {
  textLength: number;
  reasoningLength: number;
};

function readLatestAssistantState(
  messages: UIMessage[],
): AssistantMessageState {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    return message.parts.reduce<AssistantMessageState>(
      (acc, part) => {
        if (part.type === "text") {
          acc.textLength += part.text.trim().length;
        } else if (part.type === "reasoning") {
          acc.reasoningLength += part.text.trim().length;
        }
        return acc;
      },
      { textLength: 0, reasoningLength: 0 },
    );
  }
  return { textLength: 0, reasoningLength: 0 };
}

export class DownyAgent extends Think {
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_BUCKET,
    name: () => this.name,
  });

  override maxSteps = 250;

  override chatRecovery = true;

  // Wait for the base Agent's hibernation restore before each turn so MCP
  // tools are available without asking the user to reconnect.
  override waitForMcpConnections = true;

  #bootstrapInit?: Promise<void>;

  // Default model used if `beforeTurn` doesn't override it (e.g. recovery
  // turns that bypass the hook). Real per-turn selection happens in
  // `beforeTurn` based on the user's `ai_provider` preference.
  override getModel(): LanguageModel {
    return getModelFor(this.env, DEFAULT_AI_PROVIDER);
  }

  // Shared tools live in `tool-registry.ts`; parent-only tools are layered on.
  override getTools(): ToolSet {
    return {
      ...toolRegistry.buildSharedToolSet({
        env: this.env,
        getWorkspace: () => this.workspace,
        parentSlug: this.name,
        bumpPeerReadCount: () => this.bumpPeerReadCount(),
        setActivePlan: (plan) => this.#setActivePlan(plan),
      }),
      read_user_profile: createReadUserProfileTool({ db: this.env.DB }),
      write_user_profile: createWriteUserProfileTool({ db: this.env.DB }),
      spawn_background_task: createSpawnBackgroundTaskTool({
        namespace: this.env.ChildAgent,
        parentName: this.name,
        putRecord: (id, record) =>
          this.ctx.storage.put(backgroundTaskKey(id), record),
        broadcastUpdate: (record) => {
          this.#broadcastBackgroundTaskUpdate(record);
        },
      }),
      schedule_task: createScheduleTaskTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      list_scheduled_tasks: createListScheduledTasksTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      update_scheduled_task: createUpdateScheduledTaskTool({ db: this.env.DB }),
      delete_scheduled_task: createDeleteScheduledTaskTool({ db: this.env.DB }),
      create_buildroom_job: createBuildroomJobTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      list_buildroom_jobs: createListBuildroomJobsTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      write_campaign_artifact: createWriteCampaignArtifactTool({
        agentSlug: this.name,
        getWorkspace: () => this.workspace,
      }),
      read_campaign_artifact: createReadCampaignArtifactTool({
        getWorkspace: () => this.workspace,
      }),
      list_campaign_schedule_presets: createListCampaignSchedulePresetsTool(),
      schedule_campaign_room_preset: createScheduleCampaignRoomPresetTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      list_buildroom_workflow_templates:
        createListBuildroomWorkflowTemplatesTool({
          db: this.env.DB,
          agentSlug: this.name,
        }),
      create_buildroom_workflow_template:
        createCreateBuildroomWorkflowTemplateTool({
          db: this.env.DB,
          agentSlug: this.name,
        }),
      start_buildroom_workflow: createStartBuildroomWorkflowTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      get_buildroom_workflow: createGetBuildroomWorkflowTool({
        db: this.env.DB,
      }),
      advance_buildroom_workflow: createAdvanceBuildroomWorkflowTool({
        advance: (input) => this.advanceWorkflow(input),
      }),
      record_buildroom_gate_decision: createRecordBuildroomGateDecisionTool({
        db: this.env.DB,
      }),
      confirm_local_hands_action: createConfirmLocalHandsActionTool({
        db: this.env.DB,
      }),
      list_local_hands_actions: createListLocalHandsActionsTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      request_local_hands_action: createRequestLocalHandsActionTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      request_grok_research: createRequestGrokResearchTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      connect_cloudflare_mcp_server: createConnectCloudflareMcpServerTool({
        agent: this,
      }),
      find_tool_setup: createFindToolSetupTool(this.env),
      request_credential: createRequestCredentialTool({
        db: this.env.DB,
        agentSlug: this.name,
      }),
      connect_mcp_server: createConnectMcpServerTool({ agent: this }),
      list_mcp_servers: createListMcpServersTool({ agent: this }),
      disconnect_mcp_server: createDisconnectMcpServerTool({ agent: this }),
    };
  }

  override configureSession(session: Session) {
    // Summarize the middle of the transcript once context exceeds ~150k tokens.
    //
    // Threshold is tuned for 200k-window models (Claude Sonnet/Opus, GPT-5).
    // Pi/Codex with high reasoning consumes more output tokens, so we leave
    // ~50k of headroom for the model's own reply + tool fan-out.
    const compactFn = createCompactFunction({
      summarize: async (prompt) => {
        const provider = await readAiProvider(this.env.DB).catch(
          () => DEFAULT_AI_PROVIDER,
        );
        const result = await generateText({
          model: getModelFor(this.env, provider),
          prompt,
        });
        return result.text;
      },
    });
    return session
      .onCompaction(compactFn)
      .compactAfter(150_000)
      .withCachedPrompt();
  }

  #abortsWrapped = false;
  override async onStart(): Promise<void> {
    await super.onStart();
    await this.mcp.waitForConnections({ timeout: 10_000 });
    await this.#restoreMcpServers();
    await this.mcp.waitForConnections({ timeout: 10_000 });
    if (this.#abortsWrapped) return;
    this.#abortsWrapped = true;
    ignoreClientCancels(this, "[agent]");
  }

  #turnStartedAt = 0;
  #lastChunkAt = 0;
  #chunkCount = 0;
  #lastStepFinishAt = 0;
  #lastFinishReason: string | null = null;
  #lastStepToolCalls = 0;
  #lastStepToolResults = 0;

  // Per-turn peer-read counter — reset in beforeTurn, incremented by
  // read_peer_agent. Hard cap is a safety net so a misbehaving turn can't
  // fan out unbounded across peers.
  #peerReadCount = 0;
  bumpPeerReadCount(): number {
    return (this.#peerReadCount += 1);
  }

  // Persist (or clear) the latest `todo_write` plan. Read back in
  // `beforeTurn` so the next turn's system prompt carries an `## Active
  // plan` section — see `renderActivePlanSection` in build-system-prompt.ts.
  async #setActivePlan(plan: ActivePlan | null): Promise<void> {
    if (plan == null) await this.ctx.storage.delete(ACTIVE_PLAN_KEY);
    else await this.ctx.storage.put(ACTIVE_PLAN_KEY, plan);
  }

  // Cache the agent's own privacy flag for ~5s so peer-read RPCs don't hit
  // D1 on every call within a chatty turn.
  #privateCachedAt = 0;
  #privateCached = false;
  async #isThisAgentPrivate(): Promise<boolean> {
    const now = Date.now();
    if (now - this.#privateCachedAt < 5_000) return this.#privateCached;
    const record = await getAgent(this.env.DB, this.name);
    this.#privateCached = record?.isPrivate ?? false;
    this.#privateCachedAt = now;
    return this.#privateCached;
  }

  override async beforeTurn(ctx: {
    system: string;
    messages: unknown[];
    tools: ToolSet;
    continuation: boolean;
  }) {
    await this.#ensureBootstrapSeeded();
    await this.#restoreMcpServers();
    this.#turnStartedAt = Date.now();
    this.#lastChunkAt = 0;
    this.#chunkCount = 0;
    this.#lastStepFinishAt = 0;
    this.#lastFinishReason = null;
    this.#lastStepToolCalls = 0;
    this.#lastStepToolResults = 0;
    this.#peerReadCount = 0;
    console.log("[agent] beforeTurn", {
      messageCount: ctx.messages.length,
      continuation: ctx.continuation,
      startedAt: this.#turnStartedAt,
    });
    const [userFile, allAgents, aiProvider, latestPlan] = await Promise.all([
      readUserFile(this.env.DB),
      listAgents(this.env.DB),
      readAiProvider(this.env.DB),
      this.ctx.storage.get<ActivePlan>(ACTIVE_PLAN_KEY).then((v) => v ?? null),
    ]);
    const peers = allAgents.filter((a) => a.slug !== this.name);
    const system = await buildSystemPrompt(
      this.workspace,
      userFile.content,
      peers,
      latestPlan,
    );
    const latestUser = this.messages.reduce<UIMessage | undefined>(
      (latest, message) => (message.role === "user" ? message : latest),
      undefined,
    );
    if (latestUser?.id.startsWith("voice-request:")) {
      return {
        system: `${system}\n\nThis is a voice request. Answer the caller's latest request, accounting for corrections in the approximate transcript. Earlier requests are context, not instructions to repeat. Use workspace reads for evidence. When explicitly asked for a summary document or report, read its sources and use write to save a NEW Markdown file directly in workspace/research/, workspace/reports/ or workspace/drafts/. Do this in this turn; do not delegate to spawn_background_task, which is unavailable in voice. Never overwrite a file. A report is saved only when write returns saved:true. A failed tool call means the action did not happen: repair the input and retry only if the action is allowed; otherwise explain the failure. Never end with a promise to continue when no work is running. Do not send, publish, approve, schedule, edit existing files, connect services, or invoke other actions; direct those requests to chat controls. Never ask for or repeat credentials. Keep the spoken answer short. Refer to files by their human-readable title; never spell out a workspace path, filename or URL. Verified file links are added to chat automatically after successful reads or saves.`,
        model: getModelFor(this.env, aiProvider),
        activeTools: voiceReadTools(Object.keys(ctx.tools), true),
        tools: voiceToolSet(ctx.tools, (path, content) =>
          this.ctx.blockConcurrencyWhile(async () => {
            if (await this.workspace.exists(path))
              throw new Error(
                "Report already exists. Choose a new filename; voice cannot overwrite files.",
              );
            await this.workspace.writeFile(path, content);
            if ((await this.workspace.readFile(path)) !== content)
              throw new Error("Report save could not be verified.");
          }),
        ),
        maxSteps: 12,
      };
    }
    const mcpTools = toolRegistry.buildMcpProxyTools({
      descriptors: listMcpToolDescriptors(this.mcp),
      callTool: (serverId, name, args) =>
        this.callMcpToolWithRecovery(serverId, name, args),
    });
    return {
      system,
      model: getModelFor(this.env, aiProvider),
      tools: mcpTools,
      activeTools: toolRegistry.activeToolsWithMcpWrappers(ctx.tools, mcpTools),
    };
  }

  // Structured logging to diagnose stuck-tool-call cases — fires for every
  // step of the agent loop. `finishReason` ≠ "stop" / "tool-calls" is a smoke
  // signal (e.g. "length" means the model hit its max-token budget mid-turn
  // and tool calls won't complete). `toolCalls.length !== toolResults.length`
  // would mean a tool call was emitted but its result never landed.
  override onStepFinish(ctx: {
    stepType: string;
    text: string;
    toolCalls: unknown[];
    toolResults: unknown[];
    finishReason: string;
    usage?: unknown;
  }): void {
    this.#lastStepFinishAt = Date.now();
    this.#lastFinishReason = ctx.finishReason;
    this.#lastStepToolCalls = ctx.toolCalls.length;
    this.#lastStepToolResults = ctx.toolResults.length;
    console.log("[agent] step finished", {
      stepType: ctx.stepType,
      finishReason: ctx.finishReason,
      toolCalls: ctx.toolCalls.length,
      toolResults: ctx.toolResults.length,
      textLen: ctx.text.length,
      chunksThisTurn: this.#chunkCount,
      msSinceTurnStart: Date.now() - this.#turnStartedAt,
    });
    if (ctx.toolCalls.length !== ctx.toolResults.length) {
      console.warn("[agent] step ended with mismatched tool calls / results", {
        toolCalls: ctx.toolCalls,
        toolResults: ctx.toolResults,
      });
    }
    void this.#recordModelUsage(ctx.usage);
  }

  async #recordModelUsage(rawUsage: unknown): Promise<void> {
    const parsed = parseUsage(rawUsage);
    if (!parsed) return;
    const current =
      (await this.ctx.storage.get<ModelTokenUsage>(MODEL_USAGE_KEY)) ??
      EMPTY_MODEL_USAGE;
    await this.ctx.storage.put(MODEL_USAGE_KEY, {
      inputTokens: current.inputTokens + parsed.inputTokens,
      outputTokens: current.outputTokens + parsed.outputTokens,
      totalTokens: current.totalTokens + parsed.totalTokens,
      turnCount: current.turnCount + 1,
    } satisfies ModelTokenUsage);
  }

  // Token-level visibility, throttled so it doesn't flood. Also lets us see
  // the gap between the last chunk and the abort — an abort that arrives
  // within the same tick as the last chunk points at an explicit cancel
  // (client stop / stream close); a long quiet gap points at the server
  // waiting on something that never came back.
  override onChunk(): void {
    const now = Date.now();
    this.#chunkCount += 1;
    // First chunk, then every 1s to keep volume sane.
    if (this.#lastChunkAt === 0 || now - this.#lastChunkAt > 1000) {
      console.log("[agent] chunk", {
        chunkCount: this.#chunkCount,
        msSinceTurnStart: now - this.#turnStartedAt,
      });
    }
    this.#lastChunkAt = now;
  }

  override onChatResponse(result: {
    requestId: string;
    continuation: boolean;
    status: "completed" | "error" | "aborted";
    error?: string;
  }): void {
    const now = Date.now();
    const assistantState = readLatestAssistantState(this.messages);
    const warning = this.#diagnoseChatResponse(result.status, assistantState);
    console.log("[agent] chat response", {
      requestId: result.requestId,
      status: result.status,
      continuation: result.continuation,
      error: result.error,
      chunks: this.#chunkCount,
      msSinceTurnStart: now - this.#turnStartedAt,
      msSinceLastChunk: this.#lastChunkAt ? now - this.#lastChunkAt : null,
      msSinceLastStepFinish: this.#lastStepFinishAt
        ? now - this.#lastStepFinishAt
        : null,
      assistantTextLength: assistantState.textLength,
      assistantReasoningLength: assistantState.reasoningLength,
      warning,
    });
    void this.#recordTurnDiagnostic({
      requestId: result.requestId,
      status: result.status,
      completedAt: now,
      durationMs: this.#turnStartedAt ? now - this.#turnStartedAt : null,
      chunks: this.#chunkCount,
      assistantTextLength: assistantState.textLength,
      assistantReasoningLength: assistantState.reasoningLength,
      finishReason: this.#lastFinishReason,
      toolCalls: this.#lastStepToolCalls,
      toolResults: this.#lastStepToolResults,
      warning,
      error: result.error ?? null,
    });
  }

  #diagnoseChatResponse(
    status: "completed" | "error" | "aborted",
    assistantState: AssistantMessageState,
  ): string | null {
    if (status === "error") return "Model or agent turn ended with an error.";
    if (status === "aborted") return "Stream was aborted before completion.";
    if (this.#chunkCount === 0) return "No stream chunks were received.";
    if (this.#lastStepToolCalls !== this.#lastStepToolResults) {
      return "Tool calls and tool results did not match.";
    }
    if (assistantState.textLength === 0 && assistantState.reasoningLength > 0) {
      return "Model produced reasoning but no visible answer.";
    }
    if (assistantState.textLength === 0) {
      return "Completed turn produced no visible assistant text.";
    }
    return null;
  }

  async #recordTurnDiagnostic(diagnostic: ModelTurnDiagnostic): Promise<void> {
    await this.ctx.storage.put(MODEL_TURN_DIAGNOSTIC_KEY, diagnostic);
    if (diagnostic.warning) {
      console.warn("[agent] turn diagnostic warning", diagnostic);
    }
  }

  override onChatError(error: unknown): unknown {
    console.error("[agent] chat error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msSinceTurnStart: this.#turnStartedAt
        ? Date.now() - this.#turnStartedAt
        : null,
      msSinceLastChunk: this.#lastChunkAt
        ? Date.now() - this.#lastChunkAt
        : null,
    });
    return error;
  }

  // Seed BOOTSTRAP.md exactly once per deployment. Concurrent turns share the
  // same promise so only one writer runs; the durable flag prevents re-seeding
  // after the agent deletes the file to mark the ritual complete.
  #ensureBootstrapSeeded(): Promise<void> {
    this.#bootstrapInit ??= this.#seedBootstrapOnce();
    return this.#bootstrapInit;
  }

  async #seedBootstrapOnce(): Promise<void> {
    const seeded = await this.ctx.storage.get<boolean>(BOOTSTRAP_SEEDED_KEY);
    if (seeded === true) return;
    await this.workspace.writeFile(BOOTSTRAP_PATH, BOOTSTRAP_SEED);
    await this.ctx.storage.put(BOOTSTRAP_SEEDED_KEY, true);
  }

  // Kicks off the bootstrap ritual by injecting a synthetic user message, so
  // the agent speaks first on a fresh chat instead of waiting for input.
  // The client filters kickoff messages from the transcript using the
  // `metadata.kickoff` flag.
  //
  // `saveMessages` always starts a new inference turn, even when its callback
  // returns `current` unchanged — so we gate on `this.messages.length` BEFORE
  // calling it, otherwise every refresh retriggers the greeting.
  async startBootstrapIfPending(): Promise<{ started: boolean }> {
    await this.#ensureBootstrapSeeded();
    if (this.messages.length > 0) return { started: false };
    const pending = (await this.workspace.readFile(BOOTSTRAP_PATH)) != null;
    if (!pending) return { started: false };

    const result = await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "begin" }],
        metadata: { kickoff: true },
      },
    ]);
    return { started: result.status === "completed" };
  }

  async getVoiceContext(): Promise<string> {
    // Plain conversation text only: never forward tool inputs, credentials,
    // reasoning, or hidden context to the speech provider. <= 8KB UTF-8.
    return this.messages
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")}`,
      )
      .join("\n")
      .slice(-2000);
  }

  #voicePending = new Set<string>();

  async runVoiceTurn(
    callId: string,
    delegationId: string,
    transcript: string,
  ): Promise<string> {
    const id = `voice-request:${callId}:${delegationId}`;
    if (this.#voicePending.has(id))
      return "This lookup is already running; check the chat for its result.";
    this.#voicePending.add(id);
    try {
      return await this.#runVoiceTurnOnce(callId, delegationId, transcript, id);
    } finally {
      this.#voicePending.delete(id);
    }
  }

  async #runVoiceTurnOnce(
    callId: string,
    delegationId: string,
    transcript: string,
    id: string,
  ): Promise<string> {
    const key = `voice-result:${callId}:${delegationId}`;
    const previous = await this.ctx.storage.get<string>(key);
    if (previous) return previous;
    // Mark BEFORE inference; a restarted or duplicated delegation never reruns
    // tools. Pending/unknown work can be inspected in the shared transcript.
    await this.ctx.storage.put(
      key,
      "This lookup was already received. Check the chat for its result; it has not been run again.",
    );
    const pilotAnswer = await handlePilotVoiceRequest(transcript, {
      latest: async () => {
        const latest = await this.ctx.storage.get<string>(
          "pilot-choice:latest",
        );
        return latest ? this.getPilotChoice(latest) : null;
      },
      create: () => this.createPilotChoices(),
      select: (ticket, option) => this.selectPilotChoice(ticket, option),
    });
    if (pilotAnswer !== null) {
      await this.ctx.storage.put(key, pilotAnswer);
      return pilotAnswer;
    }
    const submitted = await this.saveMessages([
      {
        id,
        role: "user",
        parts: [
          {
            type: "text",
            text: `Voice lookup — answer the latest question in this approximate call transcript:\n${transcript.slice(-8000)}`,
          },
        ],
      },
    ]);
    const index = this.messages.findIndex((message) => message.id === id);
    if (submitted.status === "skipped" || index < 0) {
      const cancelled =
        "That lookup was cancelled or its conversation was cleared. Please ask again.";
      await this.ctx.storage.put(key, cancelled);
      return cancelled;
    }
    const after = this.messages.slice(index + 1);
    const nextUser = after.findIndex((message) => message.role === "user");
    const turn = nextUser < 0 ? after : after.slice(0, nextUser);
    const outcome = voiceTurnOutcome(turn);
    const answer = outcome.text;
    if (outcome.unverifiedFileClaim) {
      // Model prose alone cannot publish a usable file link or a save receipt.
      // Correct its unsupported completion before broadcasting the voice result.
      const reply = turn
        .filter(
          (message) =>
            message.role === "assistant" &&
            !message.id.startsWith("voice-transcript:") &&
            message.parts.some((part) => part.type === "text"),
        )
        .at(-1);
      const lastText = reply?.parts
        .filter((part) => part.type === "text")
        .at(-1);
      if (reply && lastText)
        this.session.updateMessage({
          ...reply,
          parts: reply.parts.map((part) =>
            part === lastText ? { ...part, text: answer } : part,
          ),
        });
    }
    if (outcome.corrected || outcome.filePaths.length) {
      const receipt = {
        id: `voice-outcome:${callId}:${delegationId}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: voiceOutcomeChatText(outcome, this.name),
          },
        ],
      };
      if (!this.session.getMessage(receipt.id))
        await this.session.appendMessage(receipt);
      this.broadcast(
        JSON.stringify({
          type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
          messages: this.messages,
        }),
      );
    }
    await this.ctx.storage.put(key, answer);
    return answer;
  }

  async saveVoiceTranscript(callId: string, transcript: string): Promise<void> {
    const message = {
      id: `voice-transcript:${callId}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `**Voice call · approximate captions**\n\n${transcript.slice(-24_000)}\n\n*Long calls retain the most recent captions. Audio is not saved by Downy.*`,
        },
      ],
    };
    if (this.session.getMessage(message.id))
      this.session.updateMessage(message);
    else await this.session.appendMessage(message);
    this.broadcast(
      JSON.stringify({
        type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
  }

  async saveBrowserResearch(actionId: string, value: unknown): Promise<string> {
    const result = BrowserResearchSchema.parse(value);
    const path = normalizeWorkspacePath(browserResearchPath(actionId));
    assertChildWorkspaceCallAllowed("writeFile", [path]);
    // The handler passes the immutable, completed D1 result. Re-delivery writes
    // the same files and receipt, without another browser read or model turn.
    await this.workspace.writeFile(path, browserResearchMarkdown(result));
    await this.workspace.writeFile(
      path.replace(/\.md$/, ".json"),
      JSON.stringify(result, null, 2),
    );
    const message = {
      id: `browser-research:${actionId}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `**Studio browser research completed**\n\nCaptured ${result.sources.length} source(s). [Open report](/agent/${encodeURIComponent(this.name)}/workspace/${path}).\n\nThe source text is saved in the workspace for follow-up questions. This is a bounded browser capture, not an exhaustive search or independent verification.`,
        },
      ],
    };
    if (!this.session.getMessage(message.id))
      await this.session.appendMessage(message);
    this.broadcast(
      JSON.stringify({
        type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
    return path;
  }

  // Dev-only reset. Wipes the conversation, resets the bootstrap sentinel, and
  // re-seeds BOOTSTRAP.md so the next page load re-runs onboarding. Gated at
  // the HTTP layer by checking the request hostname.
  async devReset(): Promise<void> {
    this.clearMessages();
    await this.ctx.storage.delete(BOOTSTRAP_SEEDED_KEY);
    this.#bootstrapInit = undefined;
    await this.#ensureBootstrapSeeded();
  }

  async resetAgentStateForOperator(): Promise<{
    slug: string;
    deletedWorkspaceFiles: number;
    clearedStorageKeys: number;
  }> {
    this.clearMessages();
    const deletedWorkspaceFiles = await this.#deleteWorkspaceTree("workspace");
    const storageKeys = await this.ctx.storage.list();
    let clearedStorageKeys = 0;
    for (const key of storageKeys.keys()) {
      await this.ctx.storage.delete(key);
      clearedStorageKeys += 1;
    }
    this.#bootstrapInit = undefined;
    await this.#ensureBootstrapSeeded();
    return {
      slug: this.name,
      deletedWorkspaceFiles,
      clearedStorageKeys,
    };
  }

  async #deleteWorkspaceTree(dir: string): Promise<number> {
    const entries = await this.workspace.readDir(dir).catch(() => []);
    let deleted = 0;
    for (const entry of entries) {
      if (entry.type === "directory") {
        deleted += await this.#deleteWorkspaceTree(entry.path);
      } else if (entry.type === "file") {
        await this.workspace.deleteFile(entry.path);
        deleted += 1;
      }
    }
    return deleted;
  }

  // Best-effort revert: drop the last user-initiated turn (the most recent
  // real user message + every assistant/tool message that followed). Synthetic
  // kickoff and background-task-result messages are skipped — those aren't
  // user turns the user can sensibly undo. Side effects from the deleted turn
  // (file writes, MCP calls, spawned tasks) are NOT rolled back; the client
  // surfaces a tooltip warning when the deleted turn touched anything.
  async revertLastTurn(): Promise<{ deletedCount: number }> {
    const cutoff = this.#findLastUserTurnIndex();
    if (cutoff === -1) return { deletedCount: 0 };
    const ids = this.messages.slice(cutoff).map((m) => m.id);
    this.session.deleteMessages(ids);
    // session.deleteMessages doesn't broadcast — replicate the same frame
    // Think uses internally so connected clients refresh.
    this.broadcast(
      JSON.stringify({
        type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
    return { deletedCount: ids.length };
  }

  // Edit = revert last turn, then send a new user message in its place.
  // Re-uses the same truncation logic, then hands off to saveMessages which
  // appends and triggers a fresh inference loop.
  async editLastUserMessage(text: string): Promise<{ replaced: boolean }> {
    const trimmed = text.trim();
    if (!trimmed) return { replaced: false };
    const cutoff = this.#findLastUserTurnIndex();
    if (cutoff === -1) return { replaced: false };
    const ids = this.messages.slice(cutoff).map((m) => m.id);
    this.session.deleteMessages(ids);
    // saveMessages auto-broadcasts the appended message and starts a turn,
    // so no manual broadcast is needed here.
    await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      },
    ]);
    return { replaced: true };
  }

  // Returns the index of the most recent non-synthetic user message in the
  // current transcript, or -1 if there isn't one. "Synthetic" = bootstrap
  // kickoff or background-task-result injection, which the user shouldn't
  // be able to undo because they didn't author them.
  #findLastUserTurnIndex(): number {
    const messages = this.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      if (isSyntheticUserMessage(m.metadata)) continue;
      return i;
    }
    return -1;
  }

  // Returns the agent-managed core files only (SOUL, IDENTITY, MEMORY).
  // USER.md is user-level and lives in D1 — clients fetch it separately
  // through `/api/profile/user-file`.
  async listCoreFiles(): Promise<CoreFileRecord[]> {
    return Promise.all(
      AGENT_CORE_FILES.map((meta) => resolveCoreFile(this.workspace, meta)),
    );
  }

  async readCoreFile(path: string): Promise<CoreFileRecord | null> {
    if (isProfileCorePath(path)) {
      throw new Error(
        "USER.md is user-level — read it via /api/profile/user-file",
      );
    }
    const meta = coreFileMeta(path);
    if (!meta || !isAgentCorePath(path)) return null;
    return resolveCoreFile(this.workspace, meta);
  }

  async writeCoreFile(path: string, content: string): Promise<void> {
    if (isProfileCorePath(path)) {
      throw new Error(
        "USER.md is user-level — write it via /api/profile/user-file",
      );
    }
    if (!isAgentCorePath(path)) {
      throw new Error("Path is not an agent-managed core file");
    }
    await this.workspace.writeFile(path, content);
  }

  // Walks `workspace/` recursively and returns a flat list of every file, so
  // nested paths like `workspace/content/linkedin-posts.md` show up in the
  // workspace browser — not just the top-level `content` directory. The tree
  // is naturally scoped to the model's working area: `identity/` and
  // `skills/` are siblings, not descendants, and have their own UI tabs.
  // The agent's own read/write/edit/delete tools go directly against
  // `this.workspace` and aren't affected by this listing.
  async listWorkspaceFiles(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.workspace.readDir(dir);
      for (const entry of entries) {
        if (entry.type === "directory") {
          await walk(entry.path);
        } else if (entry.type === "file") {
          out.push(entry);
        }
      }
    };
    await walk("workspace");
    return out;
  }

  #researchViewPending: Promise<ResearchSnapshot> | null = null;

  #pilotChoicePending: Promise<PilotChoice> | null = null;
  #pilotReceiptPending = new Map<string, Promise<void>>();

  async createPilotChoices(): Promise<PilotChoice> {
    if (this.#pilotChoicePending) return this.#pilotChoicePending;
    this.#pilotChoicePending = this.#createPilotChoices();
    try {
      return await this.#pilotChoicePending;
    } finally {
      this.#pilotChoicePending = null;
    }
  }

  async #createPilotChoices(): Promise<PilotChoice> {
    const latest = await this.ctx.storage.get<string>("pilot-choice:latest");
    const existing = latest ? await this.getPilotChoice(latest) : null;
    if (existing && existing.expiresAt > Date.now()) return existing;
    const models: string[] = [];
    const choice = await composePilotChoices(
      crypto.randomUUID(),
      createCloudflareEvaluator(this.env.AI, (entry) => {
        if (!models.includes(entry.model)) models.push(entry.model);
      }),
      models,
    );
    await this.ctx.storage.put({
      [`pilot-choice:${choice.id}`]: choice,
      "pilot-choice:latest": choice.id,
    });
    const message: UIMessage = {
      id: `pilot-choice:${choice.id}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `Choose a CUA research pilot. Estimated run times exclude setup. These are proposals, not started tasks. Selecting an option records a preference only.\n\n${PILOT_OPTIONS.map((option) => `${option.title}: ${option.summary} Run estimate: ${option.effort}. Needs: ${option.needs} Success: ${option.success}`).join("\n\n")}`,
        },
        { type: "data-pilot-choice", data: { ticketId: choice.id } },
      ],
    };
    await this.session.appendMessage(message);
    this.broadcast(
      JSON.stringify({
        type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
    return choice;
  }

  async getPilotChoice(id: string): Promise<PilotChoice | null> {
    if (!this.session.getMessage(`pilot-choice:${id}`)) return null;
    const parsed = PilotChoiceSchema.safeParse(
      await this.ctx.storage.get(`pilot-choice:${id}`),
    );
    if (!parsed.success) return null;
    if (parsed.data.selectedId) await this.#syncPilotSelection(parsed.data);
    if (parsed.data.sources) await this.#syncPilotSources(parsed.data);
    return parsed.data;
  }

  async selectPilotChoice(
    id: string,
    optionId: PilotOptionId,
  ): Promise<{ choice: PilotChoice | null; error: string | null }> {
    PilotOptionIdSchema.parse(optionId);
    if (!this.session.getMessage(`pilot-choice:${id}`))
      return {
        choice: null,
        error: "These options are no longer in this conversation.",
      };
    const result = await this.ctx.storage.transaction(async (txn) => {
      const parsed = PilotChoiceSchema.safeParse(
        await txn.get(`pilot-choice:${id}`),
      );
      if (!parsed.success) return { choice: null, error: "Choice not found." };
      try {
        const choice = selectedPilot(parsed.data, optionId, Date.now());
        await txn.put(`pilot-choice:${id}`, choice);
        return { choice, error: null };
      } catch {
        return {
          choice: parsed.data,
          error: parsed.data.selectedId
            ? "A pilot has already been selected."
            : "These options have expired. Request fresh options.",
        };
      }
    });
    if (result.choice?.selectedId)
      await this.#syncPilotSelection(result.choice);
    return result;
  }

  async #syncPilotSelection(choice: PilotChoice): Promise<void> {
    const pending = this.#pilotReceiptPending.get(choice.id);
    if (pending) return pending;
    const delivery = this.#deliverPilotSelection(choice);
    this.#pilotReceiptPending.set(choice.id, delivery);
    try {
      await delivery;
    } finally {
      this.#pilotReceiptPending.delete(choice.id);
    }
  }

  async savePilotSources(
    id: string,
    urls: string[],
  ): Promise<{ choice: PilotChoice | null; error: string | null }> {
    if (!this.session.getMessage(`pilot-choice:${id}`))
      return {
        choice: null,
        error: "These options are no longer in this conversation.",
      };
    const result = await this.ctx.storage.transaction(async (txn) => {
      const parsed = PilotChoiceSchema.safeParse(
        await txn.get(`pilot-choice:${id}`),
      );
      if (!parsed.success) return { choice: null, error: "Choice not found." };
      try {
        const choice = savedPilotSources(
          parsed.data,
          urls,
          Date.now(),
          crypto.randomUUID(),
        );
        await txn.put(`pilot-choice:${id}`, choice);
        return { choice, error: null };
      } catch {
        return {
          choice: parsed.data,
          error:
            "Select the comparison and supply three different web URLs without embedded credentials.",
        };
      }
    });
    if (result.choice?.sources) await this.#syncPilotSources(result.choice);
    return result;
  }

  async #syncPilotSources(choice: PilotChoice): Promise<void> {
    if (!choice.sources) return;
    const key = `sources:${choice.id}:${choice.sources.revision}`;
    const pending = this.#pilotReceiptPending.get(key);
    if (pending) return pending;
    const delivery = this.#deliverPilotSources(choice);
    this.#pilotReceiptPending.set(key, delivery);
    try {
      await delivery;
    } finally {
      this.#pilotReceiptPending.delete(key);
    }
  }

  async #deliverPilotSources(choice: PilotChoice): Promise<void> {
    if (!choice.sources) return;
    const id = `pilot-sources:${choice.id}:${choice.sources.revision}`;
    const messages: UIMessage[] = [
      {
        id,
        role: "user",
        parts: [
          {
            type: "text",
            text: `I saved these three URLs for the CUA source comparison. This prepares the brief only; do not start research yet. The pages have not been read or verified.\n\n${choice.sources.urls.map((url, i) => `Source ${i + 1}: ${url}`).join("\n")}`,
          },
        ],
      },
      {
        id: `${id}:receipt`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Your three source URLs are saved with the comparison pilot. No pages have been fetched and no research has started. Ask me to prepare the comparison when you're ready.",
          },
        ],
      },
    ];
    let appended = false;
    for (const message of messages) {
      if (this.session.getMessage(message.id)) continue;
      await this.session.appendMessage(message);
      appended = true;
    }
    if (appended)
      this.broadcast(
        JSON.stringify({
          type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
          messages: this.messages,
        }),
      );
  }

  async #deliverPilotSelection(choice: PilotChoice): Promise<void> {
    const option = PILOT_OPTIONS.find((item) => item.id === choice.selectedId);
    if (!option) return;
    // Direct session appends make the user's choice visible on the next agent
    // turn without starting inference, tools, or a background task. Deterministic
    // IDs repair delivery after a retry/restart without duplicating the choice.
    const messages: UIMessage[] = [
      {
        id: `pilot-selected:${choice.id}`,
        role: "user",
        parts: [
          {
            type: "text",
            text: `I selected “${option.title}” in the pilot chooser. This records my preference only; do not start work yet.\n\n${option.summary}\nPrerequisites: ${option.needs}\nSuccess criteria: ${option.success}`,
          },
        ],
      },
      {
        id: `pilot-selection-receipt:${choice.id}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Selected **${option.title}**. Your preference is saved. No task has started. ${option.id === "source-comparison" ? "Add your three public source URLs in the selected card above and tap **Save sources** to prepare the brief." : "Ask me to prepare the pilot when you are ready."}`,
          },
        ],
      },
    ];
    let appended = false;
    for (const message of messages)
      if (!this.session.getMessage(message.id)) {
        await this.session.appendMessage(message);
        appended = true;
      }
    if (appended)
      this.broadcast(
        JSON.stringify({
          type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
          messages: this.messages,
        }),
      );
  }

  async getResearchView(): Promise<ResearchSnapshot | null> {
    const parsed = ResearchSnapshotSchema.safeParse(
      await this.ctx.storage.get("research-view:v1"),
    );
    if (!parsed.success) return null;
    const snapshot = parsed.data;
    const checks = await Promise.all(
      snapshot.records.map(async (record) => {
        const path = researchPath(record.path);
        const stat = path ? await this.workspace.stat(path) : null;
        return stat?.type === "file" && stat.updatedAt === record.updatedAt;
      }),
    );
    if (checks.some((ok) => !ok)) {
      snapshot.records = snapshot.records.filter((_, i) => checks[i]);
      snapshot.spec = fixedResearchSpec(snapshot.records);
      snapshot.composition.state = "fallback";
      snapshot.composition.reason =
        "Some files changed or were removed. Refresh this view to include their current contents.";
    }
    snapshot.checkedAt = Date.now();
    return snapshot;
  }

  async composeResearchView(mode: ResearchViewMode): Promise<ResearchSnapshot> {
    ResearchViewModeSchema.parse(mode);
    if (this.#researchViewPending) return this.#researchViewPending;
    this.#researchViewPending = this.#composeResearchView(mode);
    try {
      return await this.#researchViewPending;
    } finally {
      this.#researchViewPending = null;
    }
  }

  async #composeResearchView(
    mode: ResearchViewMode,
  ): Promise<ResearchSnapshot> {
    const files = (await this.listWorkspaceFiles())
      .filter((file) => file.size <= 128_000 && researchPath(file.path))
      // eslint-disable-next-line unicorn/no-array-sort -- Fresh filtered array; the project targets ES2022.
      .sort(
        (a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path),
      );
    const records = [];
    // Read at most twelve bounded documents. Corpus and credentials never enter
    // the candidate set; inference only sees their prepared title/kind labels.
    for (const file of files.slice(0, 12)) {
      const path = researchPath(file.path)!;
      const read = await this.readWorkspaceFile(path);
      if (!read?.stat || read.stat.size > 128_000) continue;
      const record = researchRecord(
        path,
        read.content,
        read.stat,
        records.length,
      );
      if (
        mode === "cua" &&
        !/cua|browser/i.test(`${path} ${record.title} ${record.excerpt}`)
      )
        continue;
      records.push(record);
    }
    const audit = { models: [] as string[], calls: 0, inputTokens: 0 };
    const evaluate = createCloudflareEvaluator(this.env.AI, (entry) => {
      if (!audit.models.includes(entry.model)) audit.models.push(entry.model);
      audit.calls++;
      audit.inputTokens += entry.inputTokens;
    });
    const snapshot = await composeResearchView(
      records,
      mode,
      evaluate,
      audit,
      Math.max(0, files.length - 12),
    );
    await this.ctx.storage.put("research-view:v1", snapshot);
    return snapshot;
  }

  async readWorkspaceFile(
    path: string,
  ): Promise<{ content: string; stat: FileInfo | null } | null> {
    // Stat first so we can return `null` (→ 404) for directories and missing
    // entries instead of letting `workspace.readFile` throw `EISDIR` for a
    // directory path. `readFile` would also throw on permission errors etc.
    // — we catch those and treat as "not a file."
    const stat = await this.workspace.stat(path);
    if (!stat || stat.type !== "file") return null;
    try {
      const content = await this.workspace.readFile(path);
      if (content == null) return null;
      return { content, stat };
    } catch (err) {
      console.warn("[agent] readWorkspaceFile failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async advanceWorkflow(input: AdvanceWorkflowInput) {
    return advanceCampaignWorkflow({
      env: this.env,
      agentSlug: this.name,
      input,
      readFile: (path) => this.workspace.readFile(path),
    });
  }

  async syncCorpusRepo(
    key: string,
    cursor: CorpusCursor | null,
    changedPaths?: string[],
  ) {
    const repo = corpusRepos(this.env.CORPUS_REPOS).find(
      (candidateRepo) => candidateRepo.key === key,
    );
    if (!repo) throw new Error("Unknown configured corpus repo");
    return syncCorpus({
      repo,
      workspace: this.workspace,
      token: await readSecret(this.env.GITLAB_TOKEN),
      baseUrl: this.env.GITLAB_BASE_URL,
      cursor,
      changedPaths,
    });
  }

  async writeWorkspaceFileBytes(
    path: string,
    stream: ReadableStream<Uint8Array>,
    maxBytes: number,
  ) {
    assertChildWorkspaceCallAllowed("writeFileBytes", [path]);
    const bytes = await readFetchBytes(stream, maxBytes);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    // Serialize collision selection and write against other uploads in this DO.
    return this.ctx.blockConcurrencyWhile(async () => {
      const workspacePath = await uniqueInboxPath(path, (candidate) =>
        this.workspace.exists(candidate),
      );
      await this.workspace.writeFileBytes(workspacePath, bytes);
      return { workspacePath, bytes: bytes.byteLength, sha256 };
    });
  }

  async writeWorkspaceFile(path: string, content: string): Promise<void> {
    if (isCorePath(path)) {
      throw new Error("Use writeCoreFile for identity files");
    }
    if (isBootstrapPath(path)) {
      throw new Error("BOOTSTRAP.md is managed by the agent");
    }
    await this.workspace.writeFile(path, content);
  }

  /** Skill catalog — surfaced to the UI sidebar and the /agent/:slug/skills page. */
  async listAgentSkills(): Promise<SkillEntry[]> {
    return listSkills(this.workspace);
  }

  async deleteWorkspaceFile(path: string): Promise<void> {
    if (isCorePath(path)) {
      throw new Error("Cannot delete identity files");
    }
    if (isBootstrapPath(path)) {
      throw new Error("BOOTSTRAP.md is managed by the agent");
    }
    await this.workspace.deleteFile(path);
  }

  // Called by ChildAgent via DO-to-DO RPC when a dispatched background task
  // finishes. Wakes this DO from hibernation if needed, persists the worker's
  // output as a workspace artifact under `workspace/notes/`, then injects a short
  // synthetic user turn pointing at that file. The agent reads the file via
  // its normal workspace tools when it needs the detail — this keeps the
  // conversation transcript free of multi-page research dumps.
  async onBackgroundTaskComplete(
    taskId: string,
    status: "done" | "error",
    result: string,
  ): Promise<void> {
    const key = backgroundTaskKey(taskId);
    const prior = await this.ctx.storage.get<BackgroundTaskRecord>(key);
    if (!prior) throw new Error(`No background task record for ${taskId}`);

    const trimmed = result.trim();
    let artifactPath: string | undefined;
    if (status === "done" && trimmed.length > 0) {
      const { slug, body } = parseSlugHeader(trimmed);
      artifactPath = await this.#pickArtifactPath(slug, prior.kind, taskId);
      await this.workspace.writeFile(artifactPath, body);
    }

    const next: BackgroundTaskRecord = {
      ...prior,
      status,
      completedAt: Date.now(),
      artifactPath,
    };
    await this.ctx.storage.put(key, next);
    this.#broadcastBackgroundTaskUpdate(next);

    const messageText =
      status === "done"
        ? artifactPath
          ? `<background_task ${taskId} (${next.kind}) completed — findings saved to ${artifactPath}. Read that file now, then synthesize a reply for the user.>`
          : `<background_task ${taskId} (${next.kind}) completed but produced no output. Tell the user honestly.>`
        : `<background_task ${taskId} (${next.kind}) failed>\n${trimmed}`;

    console.log("[agent] onBackgroundTaskComplete", {
      taskId,
      status,
      artifactPath,
      resultLen: result.length,
    });

    await this.saveMessages((current): UIMessage[] => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: messageText }],
        metadata: {
          backgroundTaskResult: true,
          taskId,
          taskKind: next.kind,
          backgroundTaskStatus: status,
          ...(artifactPath ? { artifactPath } : {}),
        },
      },
    ]);
  }

  async dispatchScheduledTask(args: {
    scheduleId: string;
    title: string;
    kind: string;
    brief: string;
  }): Promise<{ taskId: string }> {
    const taskId = crypto.randomUUID();
    const brief = `Scheduled task: ${args.title}\nSchedule id: ${args.scheduleId}\n\n${args.brief}`;
    const record: BackgroundTaskRecord = {
      id: taskId,
      kind: `scheduled:${args.kind}`,
      brief,
      status: "running",
      spawnedAt: Date.now(),
    };
    await this.ctx.storage.put(backgroundTaskKey(taskId), record);
    this.#broadcastBackgroundTaskUpdate(record);
    const stub = await getAgentByName(this.env.ChildAgent, taskId);
    await stub.startTask({
      parentName: this.name,
      taskId,
      kind: record.kind,
      brief,
    });
    return { taskId };
  }

  // ChildAgent calls these over RPC — a child can't open its own MCP
  // connections (the live transport / OAuth state lives here). See
  // mcp-proxy.ts and ChildAgent#beforeTurn.
  async listMcpToolsForChild(): Promise<McpToolDescriptor[]> {
    return listMcpToolDescriptors(this.mcp);
  }

  async callMcpToolForChild(
    serverId: string,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    return this.callMcpToolWithRecovery(serverId, name, args);
  }

  async callMcpToolWithRecovery(
    serverId: string,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    try {
      return await callMcpToolViaParent(this.mcp, serverId, name, args);
    } catch (err) {
      if (!isReconnectableMcpError(err)) throw err;
      const rebuiltId = await this.#rebuildStoredMcpServer(serverId);
      if (!rebuiltId) throw err;
      return callMcpToolViaParent(this.mcp, rebuiltId, name, args);
    }
  }

  // Workspace RPC for ChildAgent. The child's `this.workspace` is a Proxy
  // that funnels every method call through here, so workspace-backed tools
  // (skills, file read/write/edit/delete, glob) operate on this agent's
  // workspace from inside the background worker. Allowlisted to public
  // Workspace methods — internal `_*` methods stay off-limits.
  async workspaceCallForChild(
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    assertChildWorkspaceCallAllowed(method, args);
    // Structural dispatch over the Workspace surface; the allowlist above
    // is the safety boundary. Indexed via Reflect so we don't have to fight
    // the type system with a hand-rolled record cast.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- structural dispatch; allowlist gates the keys.
    const fn = Reflect.get(this.workspace, method) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    return fn.apply(this.workspace, args);
  }

  // Slug of *this* agent — exposed so ChildAgent can build its peer-read
  // tool with the parent's slug as the self-reference, matching parent's
  // behavior (a child reads its own peers, not its own DO).
  async childParentSlug(): Promise<string> {
    return this.name;
  }

  // ── MCP server config persistence ────────────────────────────────────────
  // Think's `restoreConnectionsFromStorage` covers part of this, but we
  // persist our own copy of `{name, url, transport, headers}` so a wake
  // can re-attach silently even when Bearer-token auth is involved. Storage
  // shape: `mcp_server:{id} → StoredMcpServer`.
  //
  async persistMcpServer(config: StoredMcpServer): Promise<void> {
    const { headers, ...safe } = config;
    if (headers)
      safe.encryptedHeaders = await encryptHeaders(
        headers,
        await readSecret(this.env.CREDENTIAL_KEY),
        `${this.name}:${config.id}`,
      );
    await this.ctx.storage.put(mcpServerKey(config.id), safe);
  }

  async #decryptMcpServer(config: StoredMcpServer): Promise<StoredMcpServer> {
    if (config.headers) {
      // Idempotent one-shot migration of each legacy plaintext registration.
      await this.persistMcpServer(config);
      this.ctx.storage.sql.exec(
        "UPDATE cf_agents_mcp_servers SET server_options = NULL WHERE id = ?",
        config.id,
      );
      return config;
    }
    if (!config.encryptedHeaders) return config;
    this.ctx.storage.sql.exec(
      "UPDATE cf_agents_mcp_servers SET server_options = NULL WHERE id = ?",
      config.id,
    );
    return {
      ...config,
      headers: await decryptHeaders(
        config.encryptedHeaders,
        await readSecret(this.env.CREDENTIAL_KEY),
        `${this.name}:${config.id}`,
      ),
    };
  }

  async migrateMcpCredentials(): Promise<{ migrated: number }> {
    const stored = await this.ctx.storage.list<StoredMcpServer>({
      prefix: MCP_SERVER_KEY_PREFIX,
    });
    let migrated = 0;
    for (const config of stored.values()) {
      if (!config.headers && !config.encryptedHeaders) continue;
      await this.#decryptMcpServer(config);
      migrated += 1;
    }
    return { migrated };
  }

  async connectMcpEndpoint(params: {
    name: string;
    url: string;
    transport?: McpTransport;
  }) {
    return connectMcpWithTriage(this, this.env, params);
  }

  async connectCredential(
    target: CredentialTarget,
    headers: Record<string, string>,
  ): Promise<CredentialOutcome> {
    await encryptHeaders(
      {},
      await readSecret(this.env.CREDENTIAL_KEY),
      "preflight",
    );
    try {
      const result = await connectMcpWithTriage(this, this.env, {
        name: target.serverName,
        url: target.url,
        transport: target.transport,
        headers,
      });
      return {
        state: result.state,
        toolNames: result.toolNames,
        error: result.error,
        ...(result.credentialRequest
          ? { credentialRequest: result.credentialRequest }
          : {}),
      };
    } catch {
      return { state: "failed", toolNames: [], error: "Connection failed" };
    }
  }

  async forgetMcpServer(id: string): Promise<void> {
    await this.ctx.storage.delete(mcpServerKey(id));
  }

  async disconnectMcpServer(id: string): Promise<void> {
    await this.removeMcpServer(id);
    await this.forgetMcpServer(id);
  }

  async #restoreMcpServers(): Promise<void> {
    const stored = await this.ctx.storage.list<StoredMcpServer>({
      prefix: MCP_SERVER_KEY_PREFIX,
    });
    if (stored.size === 0) return;
    const live = this.getMcpServers().servers;
    const liveByServer = new Map(
      Object.entries(live).map(([id, s]) => [
        mcpServerIdentityKey(s.name, s.server_url),
        { id, state: s.state },
      ]),
    );
    for (const saved of stored.values()) {
      const config = await this.#decryptMcpServer(saved);
      const key = mcpServerIdentityKey(config.name, config.url);
      const liveForServer = liveByServer.get(key);
      if (liveForServer) {
        if (!config.headers || liveForServer.state === "ready") {
          if (liveForServer.id !== config.id) {
            await this.forgetMcpServer(config.id);
            await this.persistMcpServer({ ...config, id: liveForServer.id });
          }
          continue;
        }
        await this.removeMcpServer(liveForServer.id);
      }
      try {
        const type = config.transport ?? "auto";
        let restored = false;
        if (config.headers) {
          // Header-auth path: bypass addMcpServer for the same reason the
          // connect tool does — see `tools/mcp-servers.ts` for context.
          restored = await restoreHeaderAuthServer(this.mcp, {
            ...config,
            headers: config.headers,
          });
        } else {
          const result = await this.addMcpServer(config.name, config.url, {
            transport: { type },
          });
          if (result.id !== config.id) {
            await this.forgetMcpServer(config.id);
            await this.persistMcpServer({ ...config, id: result.id });
          }
          restored = true;
          config.id = result.id;
        }
        if (restored) {
          liveByServer.set(key, { id: config.id, state: "ready" });
        }
      } catch {
        console.warn("[agent] restoreMcpServer failed", {
          id: config.id,
          name: config.name,
          // Never log headers (Bearer tokens).
          error: "Connection restore failed",
        });
      }
    }
  }

  async #rebuildStoredMcpServer(id: string): Promise<string | null> {
    const stored = await this.ctx.storage.get<StoredMcpServer>(
      mcpServerKey(id),
    );
    if (!stored) return null;
    const config = await this.#decryptMcpServer(stored);
    const rebuiltId = await rebuildMcpServer(
      this.mcp,
      config,
      (name, url, options) => this.addMcpServer(name, url, options),
    );
    if (rebuiltId && rebuiltId !== id) {
      await this.forgetMcpServer(id);
      await this.persistMcpServer({ ...config, id: rebuiltId });
    }
    return rebuiltId;
  }

  // ── Peer-agent RPC ────────────────────────────────────────────────────────
  // Read-only methods exposed to other DownyAgent instances. The frontend
  // never calls these directly; the model invokes them via the
  // `read_peer_agent` tool, which dispatches based on `op`. Each method
  // enforces its own privacy check so future callers of the RPC can't bypass
  // it. `peerDescribe` is exempt — discoverability is independent of content
  // access (the model needs to know the agent exists to mention it).

  async peerDescribe(): Promise<{
    slug: string;
    displayName: string;
    isPrivate: boolean;
    identitySummary: string;
  }> {
    const record = await getAgent(this.env.DB, this.name);
    const displayName = record?.displayName ?? this.name;
    const isPrivate = record?.isPrivate ?? false;
    let identitySummary = "";
    if (!isPrivate) {
      // First couple of lines of IDENTITY.md gives the model enough to
      // pattern-match on. Strip the markdown header so we don't waste tokens
      // on "# Identity".
      const identity = await this.workspace.readFile(IDENTITY_PATH);
      if (identity) {
        identitySummary = identity
          .replace(/^#.*$/m, "")
          .trim()
          .split(/\n\s*\n/)[0]
          .slice(0, 400);
      }
    }
    return { slug: this.name, displayName, isPrivate, identitySummary };
  }

  async peerListWorkspace(prefix?: string): Promise<FileInfo[]> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.name}`);
    }
    const all = await this.listWorkspaceFiles();
    if (!prefix) return all;
    const normalized = prefix.replace(/^\/+/, "");
    return all.filter((f) => f.path.replace(/^\/+/, "").startsWith(normalized));
  }

  async peerReadFile(
    path: string,
  ): Promise<{ content: string; stat: FileInfo | null } | null> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.name}`);
    }
    if (isAgentManagedPath(path)) {
      // Identity files are exposed via peerReadIdentityFiles, not via this
      // method — keep the surface deliberate.
      throw new Error(
        `Use peerReadIdentityFiles for ${path}, not peerReadFile.`,
      );
    }
    return this.readWorkspaceFile(path);
  }

  async peerReadIdentityFiles(): Promise<CoreFileRecord[]> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.name}`);
    }
    return this.listCoreFiles();
  }

  // Snapshot of attached MCP servers for the settings UI. Same shape as the
  // in-agent `list_mcp_servers` tool, just exposed over RPC so the frontend
  // can render it without going through the model.
  async listMcpServers(): Promise<
    Array<{
      id: string;
      name: string;
      url: string;
      state: string;
      error: string | null;
      toolNames: string[];
    }>
  > {
    const state = this.getMcpServers();
    return Object.entries(state.servers).map(([id, s]) => ({
      id,
      name: s.name,
      url: s.server_url,
      state: s.state,
      error: s.error,
      toolNames: state.tools
        .filter((t) => t.serverId === id)
        .map((t) => t.name),
    }));
  }

  // Returns every background task ever dispatched by this agent, newest first.
  async listBackgroundTasks(): Promise<BackgroundTaskRecord[]> {
    const map = await this.ctx.storage.list<BackgroundTaskRecord>({
      prefix: "background_task:",
    });
    const records = [...map.values()];
    // eslint-disable-next-line unicorn/no-array-sort -- `records` is a fresh array from the Map iterator, not a shared reference.
    records.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return records;
  }

  async getModelStatus(): Promise<ModelStatus> {
    const [usage, lastTurn] = await Promise.all([
      this.ctx.storage.get<ModelTokenUsage>(MODEL_USAGE_KEY),
      this.ctx.storage.get<ModelTurnDiagnostic>(MODEL_TURN_DIAGNOSTIC_KEY),
    ]);
    return buildModelStatus({
      db: this.env.DB,
      env: this.env,
      lastTurn,
      usage,
    });
  }

  async readBuildroomJob(jobId: string): Promise<{
    job: Awaited<ReturnType<typeof getBuildroomJob>>;
    events: Awaited<ReturnType<typeof listBuildroomEvents>>;
  }> {
    const job = await getBuildroomJob(this.env.DB, jobId);
    if (!job) throw new Error(`Unknown buildroom job: ${jobId}`);
    if (job.agentSlug !== this.name) {
      throw new Error("Buildroom job belongs to a different agent");
    }
    const events = await listBuildroomEvents(this.env.DB, jobId);
    return { job, events };
  }

  async readBuildroomArtifact(
    jobId: string,
    artifactName: BuildroomArtifactName,
  ): Promise<BuildroomArtifact | null> {
    const job = await getBuildroomJob(this.env.DB, jobId);
    if (!job) throw new Error(`Unknown buildroom job: ${jobId}`);
    if (job.agentSlug !== this.name) {
      throw new Error("Buildroom job belongs to a different agent");
    }
    return readBuildroomArtifact({
      workspace: this.workspace,
      jobId,
      artifactName,
    });
  }

  async readCampaignArtifact(
    jobId: string,
    artifactName: CampaignArtifactName,
  ): Promise<CampaignArtifact | null> {
    const job = await getBuildroomJob(this.env.DB, jobId);
    if (!job) throw new Error(`Unknown buildroom job: ${jobId}`);
    if (job.agentSlug !== this.name) {
      throw new Error("Campaign job belongs to a different agent");
    }
    return readCampaignArtifactFile({
      workspace: this.workspace,
      jobId,
      artifactName,
    });
  }

  async writeCampaignArtifact(
    jobId: string,
    artifact: unknown,
  ): Promise<Awaited<ReturnType<typeof writeCampaignArtifactFile>>> {
    const job = await getBuildroomJob(this.env.DB, jobId);
    if (!job) throw new Error(`Unknown buildroom job: ${jobId}`);
    if (job.agentSlug !== this.name) {
      throw new Error("Campaign job belongs to a different agent");
    }
    return writeCampaignArtifactFile({
      workspace: this.workspace,
      agentSlug: this.name,
      jobId,
      artifact,
    });
  }

  #broadcastBackgroundTaskUpdate(record: BackgroundTaskRecord): void {
    this.broadcast(
      JSON.stringify({ type: BACKGROUND_TASK_UPDATED_TYPE, record }),
    );
  }

  // Pick a workspace path for the worker's artifact. Prefer the slug the
  // worker proposed in its `slug:` header (descriptive, e.g.
  // `workspace/notes/openseo-content-idea-tracker.md`); fall back to a
  // generated `{date}-{kind}-{shortId}` name if the slug is missing.
  async #pickArtifactPath(
    slug: string | undefined,
    kind: string,
    taskId: string,
  ): Promise<string> {
    const shortId = taskId.slice(0, 8);
    if (slug) {
      const clean = `workspace/notes/${slug}.md`;
      if ((await this.workspace.readFile(clean)) == null) return clean;
      return `workspace/notes/${slug}-${shortId}.md`;
    }
    const date = new Date().toISOString().slice(0, 10);
    const kindSlug =
      kind
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "task";
    return `workspace/notes/${date}-${kindSlug}-${shortId}.md`;
  }
}
import {
  ResearchSnapshotSchema,
  ResearchViewModeSchema,
  fixedResearchSpec,
  type ResearchSnapshot,
  type ResearchViewMode,
} from "../../lib/research-view";
import { createCloudflareEvaluator } from "../research-view/cloudflare-evaluator";
import {
  composeResearchView,
  researchPath,
  researchRecord,
} from "../research-view/compose";
import {
  PilotChoiceSchema,
  PilotOptionIdSchema,
  PILOT_OPTIONS,
  savedPilotSources,
  selectedPilot,
  type PilotChoice,
  type PilotOptionId,
} from "../../lib/pilot-choices";
import { handlePilotVoiceRequest } from "../pilot-choices/voice";
import { composePilotChoices } from "../pilot-choices/compose";
