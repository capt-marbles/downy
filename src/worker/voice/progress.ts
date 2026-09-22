import { z } from "zod";

/**
 * One-line progress notes for the voice session, built from tool results as
 * a backend turn runs. A note says what happened at that step in plain
 * words; it is never phrased as a completed result, because only the
 * lookup's completion receipt is final.
 */
const Failed = z
  .object({ state: z.literal("failed"), error: z.string().optional() })
  .passthrough();
const Draft = z.object({ state: z.literal("draft_created") }).passthrough();
const Staged = z
  .object({ stagedActionId: z.string(), title: z.string().optional() })
  .passthrough();
const Dispatched = z
  .object({ taskId: z.string(), status: z.literal("dispatched") })
  .passthrough();
const Externalized = z
  .object({ externalized: z.literal(true), chars: z.number() })
  .passthrough();
const StepResult = z
  .object({
    toolName: z.string().optional(),
    output: z.unknown().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();

const LABELS: Record<string, string> = {
  read_skill: "loaded the runbook",
  list_skills: "listed the runbooks",
  read: "read a workspace file",
  list: "listed workspace files",
  find: "searched workspace files",
  grep: "searched workspace files",
  web_search: "searched the web",
  web_scrape: "read a web page",
  airtable_records: "read Airtable",
  slack_channels: "listed Slack channels",
  qualify_leads: "qualified the candidates",
  check_outreach_draft: "checked the draft against the voice rules",
  list_staged_actions: "checked the cards",
  list_mcp_servers: "checked connections",
  tool_treg_call: "ran a Treg lookup",
  write: "saved a report",
  read_peer_agent: "read another bot",
};

export function voiceProgressNote(toolName: string, output: unknown): string {
  const name = toolName.replace(/^tool_(?:mcp_[a-z0-9]+_)?/, "");
  const label = LABELS[toolName] ?? LABELS[name] ?? `used ${name}`;
  const failed = Failed.safeParse(output);
  if (failed.success)
    return `${label}: failed${failed.data.error ? ` (${failed.data.error.slice(0, 120)})` : ""}`;
  if (toolName === "gmail_email")
    return Draft.safeParse(output).success
      ? "saved a Gmail draft (not sent)"
      : "searched Gmail";
  if (toolName === "stage_action") {
    const staged = Staged.safeParse(output);
    return staged.success
      ? `put a card in chat awaiting your tap${staged.data.title ? `: ${staged.data.title.slice(0, 80)}` : ""}`
      : "tried to stage a card";
  }
  if (toolName === "spawn_background_task")
    return Dispatched.safeParse(output).success
      ? "started a background research task"
      : "tried to start a background task";
  if (toolName === "check_outreach_draft") {
    const verdict = z.object({ verdict: z.string() }).safeParse(output);
    return verdict.success
      ? `checked the draft: ${verdict.data.verdict}`
      : label;
  }
  const big = Externalized.safeParse(output);
  if (big.success) return `${label} (large result saved to a file)`;
  return label;
}

/** Notes for one finished step; malformed results are skipped, never thrown. */
export function voiceProgressNotesForStep(toolResults: unknown[]): string[] {
  const notes: string[] = [];
  for (const raw of toolResults) {
    const parsed = StepResult.safeParse(raw);
    if (!parsed.success || !parsed.data.toolName) continue;
    notes.push(
      voiceProgressNote(
        parsed.data.toolName,
        parsed.data.output ?? parsed.data.result,
      ),
    );
  }
  return notes;
}

export function voiceChecklistNote(outstanding: string[]): string | null {
  if (!outstanding.length) return null;
  return `working through ${outstanding.length} request${outstanding.length === 1 ? "" : "s"}: ${outstanding.map((t, i) => `${i + 1}) ${t.slice(0, 60)}`).join("; ")}`;
}

/**
 * Coalesces progress notes per lookup (or per call, for notes with no
 * delegation) and flushes them as one bounded commentary after a short
 * delay, so the voice hears what is happening without a flood of events.
 */
export class ProgressBuffer {
  private pending = new Map<string, string[]>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly flush: (delegationId: string | null, text: string) => void,
    private readonly delayMs = 1500,
  ) {}
  add(delegationId: string | null, note: string): void {
    const key = delegationId ?? "";
    const notes = this.pending.get(key) ?? [];
    if (notes.length < 8) notes.push(note.slice(0, 200));
    this.pending.set(key, notes);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.drain();
    }, this.delayMs);
  }
  drain(): void {
    for (const [key, notes] of this.pending)
      this.flush(
        key || null,
        `Backend progress (not a result; the receipt comes separately): ${notes.join("; ")}.`,
      );
    this.pending.clear();
  }
  clear(): void {
    this.pending.clear();
  }
}
