import { z } from "zod";
import { CreateScheduledTaskInputSchema } from "../worker/scheduled-tasks/types";
import { AirtableCreateRecordsSchema } from "./airtable-connect";
import { SlackPostMessageSchema } from "./slack-connect";
import { describeGrant } from "./standing-grants";

// A staged action is a proposal the agent (chat or voice) puts in chat as a
// card. Nothing runs until the operator taps Confirm on that card. Approval is
// bound to the exact payload revision the card showed, so an edited proposal
// is a new decision. No model tool can confirm; only the same-origin POST can.

const STAGED_ACTION_TTL_MS = 24 * 60 * 60_000;

const GmailDraftPayloadSchema = z
  .object({
    recipientEmail: z.string().email().max(320),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(30000),
    threadId: z.string().max(200).optional(),
  })
  .strict();

const ScheduleTaskPayloadSchema = CreateScheduledTaskInputSchema.omit({
  agentSlug: true,
  nextDueAt: true,
  enabled: true,
}).strict();

// Airtable rows carry field IDs, which no operator can read on a card, so the
// proposal also names the table and gives one plain line per record. The
// executor writes exactly `records`; the labels are for the human only.
const AirtableCreateRecordsPayloadSchema = AirtableCreateRecordsSchema.omit({
  action: true,
})
  .extend({
    tableLabel: z.string().min(1).max(120),
    recordLabels: z.array(z.string().min(1).max(300)).min(1).max(10),
  })
  .strict()
  .refine((value) => value.recordLabels.length === value.records.length, {
    message: "recordLabels must describe every record, one line each",
  });

export const StagedActionPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("gmail_draft"),
      gmailDraft: GmailDraftPayloadSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule_task"),
      scheduleTask: ScheduleTaskPayloadSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("airtable_create_records"),
      airtableCreateRecords: AirtableCreateRecordsPayloadSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("slack_post_message"),
      slackPostMessage: SlackPostMessageSchema.omit({ action: true })
        .extend({ channelLabel: z.string().min(1).max(120) })
        .strict(),
    })
    .strict(),
]);
export type StagedActionPayload = z.infer<typeof StagedActionPayloadSchema>;
type StagedActionKind = StagedActionPayload["kind"];

const StagedActionStateSchema = z.enum([
  "proposed",
  "executing",
  "succeeded",
  "failed",
  "unknown",
  "cancelled",
]);

export const StagedActionResultSchema = z
  .object({
    receipt: z.string().max(2000),
    url: z.string().url().optional(),
    reference: z.string().max(200).optional(),
  })
  .strict();

export const StagedActionSchema = z.object({
  id: z.uuid(),
  version: z.literal(1),
  source: z.enum(["chat", "voice", "scheduled"]),
  payload: StagedActionPayloadSchema,
  // Changes whenever the payload changes. The confirm request must quote it.
  revision: z.uuid(),
  createdAt: z.number(),
  expiresAt: z.number(),
  state: StagedActionStateSchema,
  // Set once, before the executor runs; a retry of the same confirmation
  // never issues a second operation.
  operationId: z.uuid().nullable(),
  confirmedAt: z.number().nullable(),
  confirmedRevision: z.uuid().nullable(),
  // Who confirmed: the operator's tap, or a standing grant on a schedule.
  confirmedBy: z
    .union([
      z.literal("operator"),
      z
        .object({
          scheduleId: z.string().min(1),
          scheduleTitle: z.string().min(1).max(120),
        })
        .strict(),
    ])
    .nullable()
    .default(null),
  finishedAt: z.number().nullable(),
  result: StagedActionResultSchema.nullable(),
  error: z.string().max(2000).nullable(),
});
export type StagedAction = z.infer<typeof StagedActionSchema>;

export const StagedActionPartSchema = z.object({
  type: z.literal("data-staged-action"),
  data: z.object({ stagedActionId: z.uuid() }),
});

export const STAGED_ACTION_LABELS: Record<StagedActionKind, string> = {
  gmail_draft: "Gmail draft",
  schedule_task: "Scheduled task",
  airtable_create_records: "Airtable records",
  slack_post_message: "Slack post",
};

export function newStagedAction(
  id: string,
  revision: string,
  source: StagedAction["source"],
  payload: StagedActionPayload,
  now: number,
): StagedAction {
  return {
    id,
    version: 1,
    source,
    payload: StagedActionPayloadSchema.parse(payload),
    revision,
    createdAt: now,
    expiresAt: now + STAGED_ACTION_TTL_MS,
    state: "proposed",
    operationId: null,
    confirmedAt: null,
    confirmedRevision: null,
    confirmedBy: null,
    finishedAt: null,
    result: null,
    error: null,
  };
}

export class StagedActionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "revision_mismatch"
      | "expired"
      | "not_proposed"
      | "already_confirmed",
  ) {
    super(message);
  }
}

/**
 * Accept one confirmation. Idempotent for a repeated confirmation of the same
 * revision once it has been accepted; anything else is a rejected decision.
 */
export function confirmedStagedAction(
  action: StagedAction,
  revision: string,
  operationId: string,
  now: number,
): StagedAction {
  if (action.revision !== revision)
    throw new StagedActionError(
      "This proposal changed since it was shown. Review the current version and confirm again.",
      "revision_mismatch",
    );
  if (action.state !== "proposed") {
    if (action.confirmedRevision === revision) return action;
    throw new StagedActionError(
      `This proposal is ${action.state}; it cannot be confirmed again.`,
      action.state === "cancelled" ? "not_proposed" : "already_confirmed",
    );
  }
  if (action.expiresAt <= now)
    throw new StagedActionError(
      "This proposal expired. Ask for a fresh one.",
      "expired",
    );
  return {
    ...action,
    state: "executing",
    operationId,
    confirmedAt: now,
    confirmedRevision: revision,
    confirmedBy: "operator",
  };
}

/**
 * Confirm a scheduled worker's proposal under a standing grant the operator
 * approved on the schedule card. Same single-flight contract as a tap: the
 * operation id is fixed here, before the executor runs.
 */
export function grantConfirmedStagedAction(
  action: StagedAction,
  schedule: { id: string; title: string },
  operationId: string,
  now: number,
): StagedAction {
  if (action.state !== "proposed")
    throw new StagedActionError(
      `This proposal is ${action.state}; it cannot be confirmed again.`,
      "already_confirmed",
    );
  return {
    ...action,
    state: "executing",
    operationId,
    confirmedAt: now,
    confirmedRevision: action.revision,
    confirmedBy: { scheduleId: schedule.id, scheduleTitle: schedule.title },
  };
}

export function cancelledStagedAction(
  action: StagedAction,
  now: number,
): StagedAction {
  if (action.state === "cancelled") return action;
  if (action.state !== "proposed")
    throw new StagedActionError(
      `This proposal is ${action.state}; it cannot be cancelled.`,
      "not_proposed",
    );
  return { ...action, state: "cancelled", finishedAt: now };
}

export function finishedStagedAction(
  action: StagedAction,
  outcome:
    | { state: "succeeded"; result: z.infer<typeof StagedActionResultSchema> }
    | { state: "failed" | "unknown"; error: string },
  now: number,
): StagedAction {
  if (action.state !== "executing")
    throw new StagedActionError(
      "Only an executing proposal can finish.",
      "not_proposed",
    );
  return outcome.state === "succeeded"
    ? { ...action, state: "succeeded", result: outcome.result, finishedAt: now }
    : {
        ...action,
        state: outcome.state,
        error: outcome.error.slice(0, 2000),
        finishedAt: now,
      };
}

export function isStagedActionOpen(action: StagedAction, now: number): boolean {
  return action.state === "proposed" && action.expiresAt > now;
}

/** Plain-language description for chat context, voice, and the card. */
export function describeStagedAction(payload: StagedActionPayload): {
  title: string;
  lines: string[];
} {
  if (payload.kind === "gmail_draft") {
    const draft = payload.gmailDraft;
    return {
      title: `Gmail draft to ${draft.recipientEmail}`,
      lines: [
        `Subject: ${draft.subject}`,
        ...(draft.threadId ? [`Reply in thread ${draft.threadId}`] : []),
        `Body:\n${draft.body}`,
      ],
    };
  }
  if (payload.kind === "slack_post_message") {
    const post = payload.slackPostMessage;
    return {
      title: `Slack post to ${post.channelLabel}`,
      lines: [`Channel: ${post.channel}`, `Message:\n${post.text}`],
    };
  }
  if (payload.kind === "airtable_create_records") {
    const write = payload.airtableCreateRecords;
    const n = write.records.length;
    return {
      title: `Create ${n} record${n === 1 ? "" : "s"} in Airtable table ${write.tableLabel}`,
      lines: [
        `Base: ${write.baseId}`,
        `Table: ${write.tableId}`,
        `Records:\n${write.recordLabels.map((label) => `- ${label}`).join("\n")}`,
        `Fields per record: ${write.records.map((r) => Object.keys(r.fields).length).join(", ")}`,
      ],
    };
  }
  const task = payload.scheduleTask;
  const cadence =
    task.scheduleType === "interval"
      ? `every ${task.intervalMinutes ?? "?"} minutes`
      : task.scheduleType === "daily"
        ? `daily at ${task.timeOfDay ?? "?"} ${task.timezone}`
        : `weekly on day ${task.dayOfWeek ?? "?"} at ${task.timeOfDay ?? "?"} ${task.timezone}`;
  const grants = task.grants ?? [];
  return {
    title: `Scheduled task “${task.title}”`,
    lines: [
      `Runs ${cadence}`,
      `Kind: ${task.kind}`,
      grants.length
        ? `Standing approval for every run:\n${grants.map((grant) => `- ${describeGrant(grant)}`).join("\n")}`
        : "Standing approval: none (the task can only read and write the workspace)",
      `Brief:\n${task.brief}`,
    ],
  };
}

export function stagedActionChatText(action: StagedAction): string {
  const { title, lines } = describeStagedAction(action.payload);
  return `Proposed action (not yet run): ${title}\n${lines.join("\n")}\n\nTap Confirm on the card in chat to run it, or Cancel. A spoken or typed “yes” does not confirm it.`;
}

/** Receipt prefix that names the approval a scheduled run acted under. */
export function stagedActionConfirmationLabel(action: StagedAction): string {
  return action.confirmedBy && action.confirmedBy !== "operator"
    ? `Run under your standing approval for “${action.confirmedBy.scheduleTitle}”`
    : "Confirmed";
}
