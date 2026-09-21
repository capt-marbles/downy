import type { UIMessage } from "ai";
import { Check, ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ToolPartSchema, type ToolPart } from "./tool-part-types";

/**
 * What the current turn has actually done: one row per tool call, from the
 * tool parts in the transcript, in order. Every row is a receipt the agent
 * produced, never a claim, so the strip cannot go stale or promise work that
 * did not happen. It replaces the model-authored checklist as the default
 * progress box; that list is shown only when the current turn wrote one.
 */

type ReceiptState = "running" | "ok" | "failed" | "blocked";

type Receipt = { name: string; detail: string; state: ReceiptState };

const FailedOutputSchema = z
  .object({ state: z.literal("failed"), error: z.string().optional() })
  .passthrough();
const InputSchema = z
  .object({
    action: z.string().optional(),
    kind: z.string().optional(),
    query: z.string().optional(),
    endpoint_id: z.string().optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    tableId: z.string().optional(),
    queries: z.array(z.unknown()).optional(),
    urls: z.array(z.unknown()).optional(),
    candidates: z.array(z.unknown()).optional(),
    brief: z.string().optional(),
  })
  .passthrough();

function toolLabel(part: ToolPart): string {
  const raw =
    part.type === "dynamic-tool"
      ? (part.toolName ?? "tool")
      : part.type.replace(/^tool-/, "");
  return raw.replace(/^tool_(?:mcp_[a-z0-9]+_)?/, "");
}

function describeReceipt(part: ToolPart): Receipt {
  const name = toolLabel(part);
  const input = InputSchema.safeParse(part.input);
  const i = input.success ? input.data : {};
  let detail = "";
  if (i.action) detail = i.action + (i.tableId ? ` ${i.tableId}` : "");
  else if (i.kind) detail = i.kind;
  else if (i.endpoint_id) detail = i.endpoint_id;
  else if (i.queries)
    detail = `${i.queries.length} quer${i.queries.length === 1 ? "y" : "ies"}`;
  else if (i.urls)
    detail = `${i.urls.length} url${i.urls.length === 1 ? "" : "s"}`;
  else if (i.candidates) detail = `${i.candidates.length} candidates`;
  else if (i.name) detail = i.name;
  else if (i.path) detail = i.path;
  else if (i.brief) detail = "background task";
  if (i.query && i.action) detail += ` ${i.query}`;
  let state: ReceiptState = "running";
  if (part.state === "output-error") state = "failed";
  else if (part.state === "output-denied") state = "blocked";
  else if (part.state === "output-available")
    state = FailedOutputSchema.safeParse(part.output).success ? "failed" : "ok";
  return { name, detail: detail.slice(0, 80), state };
}

/** Tool parts of the current turn: everything after the last user message. */
export function currentTurnReceipts(messages: UIMessage[]): Receipt[] {
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i]?.role === "user") {
      start = i + 1;
      break;
    }
  const receipts: Receipt[] = [];
  for (const message of messages.slice(start)) {
    if (message.role !== "assistant") continue;
    for (const raw of message.parts) {
      const parsed = ToolPartSchema.safeParse(raw);
      if (!parsed.success) continue;
      const part = parsed.data;
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool")
        continue;
      receipts.push(describeReceipt(part));
    }
  }
  return receipts;
}

export default function TurnReceipts({
  messages,
  working,
}: {
  messages: UIMessage[];
  working: boolean;
}) {
  const receipts = useMemo(() => currentTurnReceipts(messages), [messages]);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  if (receipts.length === 0) return null;
  const failed = receipts.filter(
    (r) => r.state === "failed" || r.state === "blocked",
  ).length;
  const running = receipts.filter((r) => r.state === "running").length;
  const isCollapsed = collapsed ?? !working;
  return (
    <div
      className="mb-2 rounded-lg border border-base-300 bg-base-200/50"
      data-testid="turn-receipts"
    >
      <button
        type="button"
        onClick={() => setCollapsed(!isCollapsed)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-base-content/70 hover:text-base-content"
      >
        {isCollapsed ? (
          <ChevronRight size={12} className="opacity-60" />
        ) : (
          <ChevronDown size={12} className="opacity-60" />
        )}
        <span className="font-medium">
          {working ? "This turn" : "Last turn"}
        </span>
        <span className="opacity-60">
          · {receipts.length} {receipts.length === 1 ? "call" : "calls"}
        </span>
        {failed ? (
          <span className="text-warning">· {failed} failed</span>
        ) : null}
        {running ? (
          <span className="loading loading-dots loading-xs ml-1 text-primary" />
        ) : null}
      </button>
      {isCollapsed ? null : (
        <ul className="space-y-1 px-3 pb-2 pt-0.5">
          {receipts.map((receipt, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-xs"
              data-state={receipt.state}
            >
              {receipt.state === "ok" ? (
                <Check size={12} className="mt-0.5 shrink-0 text-success" />
              ) : receipt.state === "running" ? (
                <span className="loading loading-spinner loading-xs mt-0.5 shrink-0 text-primary" />
              ) : (
                <CircleAlert
                  size={12}
                  className="mt-0.5 shrink-0 text-warning"
                />
              )}
              <span className="font-mono">{receipt.name}</span>
              {receipt.detail ? (
                <span className="truncate opacity-60">{receipt.detail}</span>
              ) : null}
              {receipt.state === "blocked" ? (
                <span className="rounded bg-base-300/60 px-1 text-[10px] uppercase tracking-wide opacity-60">
                  blocked
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
