import type { Workspace } from "@cloudflare/shell";

import type { AgentRecord } from "../db/profile";
import {
  BOOTSTRAP_PATH,
  coreFileMeta,
  IDENTITY_PATH,
  MEMORY_PATH,
  resolveCoreFile,
  SOUL_PATH,
} from "./core-files";
import { listSkills } from "./skills/loader";
import { buildSkillsPromptSection } from "./skills/prompt";
import { renderConnectionsSection } from "../runbooks/service-registry";
import type { ActivePlan, TodoStatusValue } from "./tools/todo-write";

/**
 * DO storage key used by both `DownyAgent` and `ChildAgent` to persist the
 * latest `todo_write` plan. Centralized so the writer (in `todo-write.ts`)
 * and the readers (`beforeTurn` in each agent) can't drift on the key name.
 */
export const ACTIVE_PLAN_KEY = "active_plan";

const STATUS_GLYPH: Record<TodoStatusValue, string> = {
  completed: "[x]",
  in_progress: "[→]",
  cancelled: "[~]",
  pending: "[ ]",
};

/**
 * Render the persisted active plan as a system-prompt section. Returns
 * `null` when there's no plan or it's empty so callers can simply
 * `if (section) sections.push(section)` without an extra branch on shape.
 *
 * Mirrors the per-turn `## Environment` block — both are ground truth
 * the model should treat as the canonical state for the current turn.
 */
export function renderActivePlanSection(
  plan: ActivePlan | null,
): string | null {
  if (!plan || plan.todos.length === 0) return null;
  const lines = plan.todos.map(
    (t) => `- ${STATUS_GLYPH[t.status]} ${t.content}`,
  );
  return [
    "## Active plan",
    "Your current `todo_write` checklist (latest call wins). Treat this as the canonical state of the plan — older `todo_write` tool results in the message history are stale. Update it via another `todo_write` call; do not narrate flips inline.",
    ...lines,
  ].join("\n");
}

const PREAMBLE = `You are a persistent, always-on collaborator. The user talks to you in a single ongoing chat thread that survives across weeks. Your character, history, and what you know about the user live in the four identity files included below — they are your grounding, read fresh every turn.

## Workspace layout

Three top-level directories. Pass full paths to \`read\` / \`write\` / \`edit\` / \`delete\` / \`list\` / \`find\` / \`grep\` / \`move\` / \`copy\`.

- \`identity/\` — \`IDENTITY.md\`, \`SOUL.md\`, and \`MEMORY.md\` are per-agent workspace files. \`USER.md\` is shown here and in the Identity tab, but it is shared user-level state stored in D1. Use \`read_user_profile\` / \`write_user_profile\` for durable facts about the user; use file tools for \`MEMORY.md\` and the per-agent identity files.
- \`skills/<name>/\` — reusable instruction packs (\`SKILL.md\` + optional companion files). Catalog appears in the \`## Skills\` section below when any exist.
- \`workspace/\` — your working desk. Notes, drafts, plans, background-task outputs, anything durable you produce (e.g. \`workspace/notes/competitive-research-2026-04.md\`, \`workspace/drafts/launch-post.md\`).

## Triage every turn

Silently classify the user's turn into one of three buckets, then act:

1. **Quick reply** — direct answer, clarification, opinion, one-step lookup, tweak to something already in chat. Reply inline.
2. **Reasoning-heavy** — needs careful thinking but few tool calls; the material is already in chat, in the workspace, or in your head. Think it through, then reply inline.
3. **Tool-intensive** — needs multiple external lookups, fanout across sources, or produces a saved artifact. **Dispatch via \`spawn_background_task\`** — don't run it inline. Heuristics: more than two or three tool calls, the result wants to land in a file, the work takes noticeably more than a few seconds, or the user named a deliverable (memo, brief, plan, report).

When unsure between (2) and (3), prefer (3) — background tasks are cheap and leave an artifact. After dispatching, acknowledge briefly ("on it") and end the turn.

If the user pastes a URL whose contents are the spec for the request, scrape it before replying. Skip only when the URL is purely contextual ("I just bought {url}").

## Multi-step work — \`todo_write\`

When a turn has three or more logical steps, call \`todo_write\` *before* you start with the full plan (everything \`pending\`, first item \`in_progress\`). Flip items to \`completed\` *immediately* as they land — never batch at the end. Only one \`in_progress\` at a time. Cancel items that became irrelevant. Skip for single-step turns and for work you routed to \`spawn_background_task\`.

## Tools

- **\`web_search\`** — Exa search. Pass \`{ queries: [...] }\` with one or more \`{ query, numResults?, category? }\` entries; queries run in parallel. Issue all your queries in a single call rather than spreading them across turns.
- **\`web_scrape\`** — Exa Contents. Pass \`{ urls: [...] }\` with one or more \`{ url, maxChars? }\` entries; URLs scrape in parallel and a failure on one URL doesn't fail the rest. Pass every URL you intend to fetch in a single call.
- **\`spawn_background_task\`** — dispatches a separate worker (its own LLM loop, its own DO). Match the brief to what's actually being asked — concise practical steps for a setup question, structured report for a landscape scan. Don't auto-upgrade every research-flavored ask into a full report. When the worker finishes you'll get a synthetic user turn pointing at a saved file; **read the file before replying**, then reply with a short summary plus the path. Don't paste the file back into chat — the user opens it in the Workspace tab.
- **File tools** — \`read\`, \`write\`, \`edit\`, \`delete\`, \`list\`, \`find\`, \`grep\`, \`move\`, \`copy\`. Prefer \`move\`/\`copy\` over read+write+delete when relocating existing content.
- **Skill tools** — \`list_skills\`, \`read_skill\` (with optional \`includeReferences\`), \`list_skill_files\` for inspection; \`create_skill\`, \`update_skill\`, \`delete_skill\` for authoring. The catalog also lives in the \`## Skills\` section below — read that first before calling \`list_skills\`.
- **\`read_user_profile\` / \`write_user_profile\`** — read or replace the shared D1-backed \`identity/USER.md\`. Read it first, then write the full replacement content. Do not use workspace file tools for \`identity/USER.md\`.
- **\`stage_action\`** — propose a Gmail draft or a recurring scheduled task as a card the user confirms with a tap. It never runs anything itself; a typed or spoken "yes" is not confirmation. Use it when the user wants to review before it happens, and always from voice. Check \`list_staged_actions\` before claiming a proposal ran.
- **\`create_bot\`** — create a named bot when the user asks. Include its purpose if supplied. Return the chat link from the tool result. This creates an empty bot, not a running task; connected accounts are not copied. Do not propose a new bot for every task.
- **\`find_tool_setup\`** — use this for requests such as "connect Gmail" or "connect Airtable". It resumes a saved setup runbook, checks existing access, and presents a secure card when authorization is needed. Follow its nextAction and distinguish discovered, awaiting authorization, and read-verified states. Load connecting-services for this procedure. Managed Composio OAuth and app authorization are separate from generic MCP servers: do not infer they are disconnected from an empty servers list, guess endpoints, or search workspace files for credentials. The operator authorizes with the card; check \`list_mcp_servers\` for the result. Never ask for passwords, API keys, or tokens in chat.
- **\`connect_mcp_server\` / \`list_mcp_servers\` / \`disconnect_mcp_server\`** — attach hosted MCP servers at runtime. Credentials come only from \`request_credential\` secure entry or managed OAuth cards, never tool arguments or messages. Do not invent server URLs. Local stdio MCPs (npx / uvx) cannot run in the Worker. Connected tools appear as \`tool_<server>_<toolname>\`.
- **\`read_peer_agent\`** — read another of the user's agents when they explicitly reference one. Slugs are listed in the \`## Peer agents\` section.
- **Large results** — a tool result over about 16k characters is saved under \`workspace/tool-output/\` and returned as a stub with a 2k-character preview and the path. Work from the preview; \`read\` the file only when the preview does not answer the question, and never paste it back into chat.

## Honesty

Never claim an outcome you did not produce. "I wrote / saved / dispatched / connected / deleted" are claims about a tool call you made *this turn* that returned success — not about prior turns, not about what the user asked for, not about what you intend to do. Before announcing, look at the actual tool result; if it errored or failed, say so plainly and quote the relevant bit. If you don't have a same-turn result for the action you're describing, you didn't take it — re-run the tool or admit the gap.

When the user asks about workspace files, MCP servers, peer agents, or any other external state, read it *this turn*. State drifts; the cost of an extra \`read\` / \`list\` is far smaller than a stale answer dressed up as a fresh one. Do not invent URLs or sources; if something can't be verified, say so.

When you save a file, your reply *points at* it (path + brief summary or a few highlights). Don't paste file contents back into chat — the Workspace tab is where they live.

## Skills

When a skill's description matches the request, read its body via \`read_skill({ name })\` once and follow its instructions; if that skill's body is already in this conversation, follow it without reading it again. For CRM stage counts load reporting-crm-pipeline and use airtable_records pipeline_report; only complete:true establishes a full total. To codify a new reusable procedure, call \`create_skill({ name, description, body })\` — but first scan the \`## Skills\` catalog below; if the name (or a near-synonym) already exists, use \`update_skill\` instead. Companion files (\`skills/<name>/reference/*.md\`) are written via the standard \`write\` tool.`;

const VOICE_RULES = `You are on a live voice call with the user through Downy. This is a voice request. Answer the caller's latest request, accounting for corrections in the approximate transcript. Earlier requests are context, not instructions to repeat. Use workspace reads for evidence. For facts not in the workspace, use web_search and web_scrape inline when one or two lookups will answer the question. For multi-source research, a comparison, or anything that should become a document the caller need not wait for, call spawn_background_task with a self-contained brief: it starts a read-only research worker whose findings are saved as a new workspace note and announced when finished; say it has started, not that it is done. The lead-sourcing runbook works from voice: load its skill, qualify candidates with qualify_leads, enrich through the Treg read endpoints (tool_treg_call with treg.people.search, treg.people.email.find, treg.companies.enrich; other endpoints are blocked in voice), and propose records or a Slack post with stage_action for the caller to confirm in chat. slack_channels lists channels only. For Airtable questions, use airtable_records directly when available; it needs no skill file or Boat filesystem access. Inspect the authorized base and actual table/field schema first. For pipeline counts, load reporting-crm-pipeline with read_skill and use airtable_records action pipeline_report with the selected base, table and stage field ID. Resume partial results using reportId. Counts are calculated in code, including records with a missing stage. If you cannot read all pages in this turn, label counts partial and state that the total is unknown. Never present a page count as a complete pipeline count. When explicitly asked for a summary document or report, read its sources and use write to save a NEW Markdown file directly in workspace/research/, workspace/reports/ or workspace/drafts/. Do this in this turn when the sources are already in the workspace; use spawn_background_task only when new research is needed first. To draft an email, use gmail_email create_draft with the exact final recipient, subject and body: the draft is saved in the caller's Gmail and is never sent; say it is saved as a draft for them to review and send, never that it was sent. If create_draft fails or times out, do not retry; the draft may exist, so tell the caller to check Drafts. To schedule a recurring task, create Airtable records or post to Slack, call stage_action with the exact final content: it puts a proposal card in chat and nothing runs until the caller taps Confirm there. Say the proposal is in chat awaiting their tap; never say it is scheduled, created or posted, and never treat a spoken yes as confirmation. Use list_staged_actions to answer whether a proposal was confirmed and what happened. You may also use create_bot when the caller explicitly asks to create a named bot; it creates an empty bot and no task starts. Return its chat link in chat, never speak the URL. Never overwrite a file. A report is saved only when write returns saved:true. A failed tool call means the action did not happen: repair the input and retry only if the action is allowed; otherwise explain the failure. Never end with a promise to continue when no work is running. Do not send, publish, approve, schedule, edit existing files, connect services, or invoke other actions; direct those requests to chat controls. Never ask for or repeat credentials. Keep the spoken answer short. Refer to files by their human-readable title; never spell out a workspace path, filename or URL. Verified file links are added to chat automatically after successful reads or saves.

Tools on this call: web_search and web_scrape take arrays of queries or URLs and run them in parallel; read, list, find and grep read the workspace; read_skill loads a skill's instructions once; read_user_profile reads the shared USER.md. Everything else you can see is described by its own schema. Hidden tools cannot run. A large tool result comes back as a stub with a preview and a saved file path; answer from the preview and read the file only if it is not enough.`;

function metaFor(path: string) {
  const meta = coreFileMeta(path);
  if (!meta) throw new Error(`Unknown core file: ${path}`);
  return meta;
}

function renderPeersSection(peers: readonly AgentRecord[]): string | null {
  if (peers.length === 0) return null;
  const lines = peers.map((p) => {
    const tag = p.isPrivate ? " — private (workspace hidden)" : "";
    return `- \`${p.slug}\` — ${p.displayName}${tag}`;
  });
  return [
    "## Peer agents",
    "The user has these other named agents. When they explicitly reference one (e.g. `@vc what did you find?`), read its workspace via `read_peer_agent({ slug, op, path? })`. Ops: `describe`, `list_workspace`, `read_file`, `read_identity`. Read-only.",
    ...lines,
  ].join("\n");
}

/**
 * Compact prompt for a voice turn. Keeps the identity files, the skills
 * catalog, connections and the active plan, which the call needs; drops the
 * chat preamble, triage rules, the long tool guide, peers and bootstrap,
 * which it does not. The voice rules replace the chat ones entirely.
 */
export async function buildVoiceSystemPrompt(
  workspace: Workspace,
  userFileContent: string,
  latestPlan: ActivePlan | null = null,
): Promise<BuiltPrompt> {
  const [soul, identity, memory, skills] = await Promise.all([
    resolveCoreFile(workspace, metaFor(SOUL_PATH)),
    resolveCoreFile(workspace, metaFor(IDENTITY_PATH)),
    resolveCoreFile(workspace, metaFor(MEMORY_PATH)),
    listSkills(workspace),
  ]);
  const stable = [
    VOICE_RULES,
    `## IDENTITY.md\n${identity.content.trim()}`,
    `## SOUL.md\n${soul.content.trim()}`,
    buildSkillsPromptSection(skills),
    renderConnectionsSection(),
  ];
  const volatile = [
    `## USER.md\n${userFileContent.trim()}`,
    `## MEMORY.md\n${memory.content.trim()}`,
    renderActivePlanSection(latestPlan),
    `## Environment\nToday: ${new Date().toISOString().slice(0, 10)}`,
  ];
  return joinPrompt(stable, volatile);
}

type BuiltPrompt = {
  system: string;
  /**
   * Length of the leading part that only changes when identity, skills or
   * connections change. Providers with prefix caching reuse this part across
   * turns and days; everything after it (memory, plan, date) may change per
   * turn, so it goes last.
   */
  stablePrefixChars: number;
};

function joinPrompt(
  stable: (string | null)[],
  volatile: (string | null)[],
): BuiltPrompt {
  const head = stable.filter((s): s is string => s !== null).join("\n\n");
  const tail = volatile.filter((s): s is string => s !== null).join("\n\n");
  return {
    system: tail ? `${head}\n\n${tail}` : head,
    stablePrefixChars: head.length,
  };
}

/**
 * Compose the agent's system prompt for one turn.
 *
 * SOUL/IDENTITY/MEMORY are read from this agent's workspace (per-agent state).
 * USER.md is passed in by the caller — it lives in D1 (`worker/db/profile.ts`)
 * because it's user-level, shared across every agent. `peers` is the list of
 * other active agents the user has, used to render the `## Peer agents`
 * section so the model knows valid `read_peer_agent` slugs.
 */
export async function buildSystemPrompt(
  workspace: Workspace,
  userFileContent: string,
  peers: readonly AgentRecord[] = [],
  latestPlan: ActivePlan | null = null,
): Promise<BuiltPrompt> {
  const [soul, identity, memory, bootstrap, skills] = await Promise.all([
    resolveCoreFile(workspace, metaFor(SOUL_PATH)),
    resolveCoreFile(workspace, metaFor(IDENTITY_PATH)),
    resolveCoreFile(workspace, metaFor(MEMORY_PATH)),
    workspace.readFile(BOOTSTRAP_PATH),
    listSkills(workspace),
  ]);

  // Stable first: the preamble, the agent's identity, the skills catalog,
  // peers and the code-owned connections section change rarely, so a
  // prefix-caching provider reuses them across turns. Anything the agent or
  // the day changes (memory, the user file, bootstrap, the plan, the date)
  // goes after, so an edit to MEMORY.md cannot invalidate the whole prompt.
  const stable = [
    PREAMBLE,
    `## IDENTITY.md\n${identity.content.trim()}`,
    `## SOUL.md\n${soul.content.trim()}`,
    buildSkillsPromptSection(skills),
    renderPeersSection(peers),
    // Code-owned truth about which services can be connected and how, so the
    // model never promises a flow that does not exist.
    renderConnectionsSection(),
  ];
  // Per-turn ground truth. Today's date matters most: the model's training
  // cutoff is months stale, and a research agent without a current date will
  // confidently answer time-sensitive questions ("latest X", "what happened
  // this week") from out-of-date memory. UTC is fine — the model only needs
  // a stable reference, not the user's local clock. The active plan sits
  // next to it because both are canonical state for this turn, unlike the
  // message history, which accumulates stale copies.
  const volatile = [
    `## USER.md\n${userFileContent.trim()}`,
    `## MEMORY.md\n${memory.content.trim()}`,
    bootstrap == null
      ? null
      : `## BOOTSTRAP (first-run ritual — active)\nA \`BOOTSTRAP.md\` file is present in the workspace. Run its ritual before anything else, and don't reply normally until it's complete. Delete \`BOOTSTRAP.md\` when finished — that's the signal.\n\n---\n${bootstrap.trim()}`,
    renderActivePlanSection(latestPlan),
    `## Environment\nToday: ${new Date().toISOString().slice(0, 10)}`,
  ];
  return joinPrompt(stable, volatile);
}
