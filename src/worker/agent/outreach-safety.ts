import { z } from "zod";

/**
 * Outreach safety, adapted from Village's send rules for a draft-only agent.
 * Every Gmail draft passes through `guardDraft`, whatever path proposed it:
 *
 * - Suppressions (opt-out, do-not-contact, bounced, manual) are hard blocks on
 *   an address or a whole `@domain`. The model may add one; only the operator
 *   removes one, on a confirmed card.
 * - Recipient history comes from Gmail, not memory: an existing draft blocks a
 *   second one; a cold draft to someone already emailed is refused, and a
 *   follow-up must name the thread it continues; after a reply, only a reply
 *   in a thread they wrote in is allowed; a bounce blocks and suppresses.
 * - The attempt is recorded before the Gmail call. An attempt whose outcome is
 *   not known blocks new drafts to that recipient until Gmail shows exactly one
 *   matching draft, or the operator abandons it on a confirmed card.
 * - Evidence Downy cannot read is treated as a block, never as a pass.
 */

export const SUPPRESSION_REASONS = [
  "opt_out",
  "do_not_contact",
  "bounced",
  "manual",
] as const;
type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

type Suppression = {
  address: string;
  reason: SuppressionReason;
  note: string | null;
  createdAt: number;
};
type DraftAttempt = {
  id: string;
  recipient: string;
  subject: string;
  threadId: string | null;
  kind: "cold" | "follow_up" | "reply";
  state: "intent" | "drafted" | "unknown" | "failed" | "abandoned";
  draftId: string | null;
  createdAt: number;
  updatedAt: number;
};
type DraftRequest = {
  recipientEmail: string;
  subject: string;
  threadId?: string;
};
type BlockCode =
  | "suppressed"
  | "unresolved_attempt"
  | "draft_exists"
  | "already_contacted"
  | "replied"
  | "bounced"
  | "thread_mismatch"
  | "unverifiable";
type DraftBlocked = {
  state: "blocked";
  code: BlockCode;
  reason: string;
  sent: false;
};

/** A Gmail search through the bot's grant, returning the raw Composio data. */
export type GmailSearch = (query: string) => Promise<unknown>;

const SuppressionTarget = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) =>
      z.string().email().safeParse(value).success ||
      /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(value),
    "Use an email address or an @domain",
  );

export function normalizeAddress(email: string): string {
  return email.trim().toLowerCase();
}

type Message = { messageId: string | null; threadId: string | null };
const Wrapped = z.object({ data: z.unknown() });
const unwrap = (value: unknown) => {
  const parsed = Wrapped.safeParse(value);
  return parsed.success ? parsed.data.data : undefined;
};
const threadsOf = (messages: Message[]) =>
  new Set(messages.flatMap((m) => (m.threadId ? [m.threadId] : [])));
/**
 * Messages from a GMAIL_FETCH_EMAILS result. Composio may nest the list under
 * `data`, and omits it when nothing matched. An unrecognized shape is `null`,
 * which callers must treat as unverifiable, not as "no messages".
 */
export function searchMessages(result: unknown): Message[] | null {
  const data = unwrap(result) ?? result;
  for (const candidate of [data, unwrap(data)]) {
    const parsed = z
      .object({
        messages: z
          .array(
            z
              .object({
                messageId: z.string().nullish(),
                threadId: z.string().nullish(),
              })
              .passthrough(),
          )
          .nullish(),
        resultSizeEstimate: z.number().optional(),
      })
      .passthrough()
      .safeParse(candidate);
    if (
      parsed.success &&
      (parsed.data.messages !== undefined ||
        parsed.data.resultSizeEstimate !== undefined)
    )
      return (parsed.data.messages ?? []).map((message) => ({
        messageId: message.messageId ?? null,
        threadId: message.threadId ?? null,
      }));
  }
  return null;
}

// Gmail search terms: strip what would change the query's meaning.
const term = (value: string) => value.replace(/["(){}]/g, " ").trim();

const blocked = (code: BlockCode, reason: string): DraftBlocked => ({
  state: "blocked",
  code,
  reason: `${reason} Nothing was drafted.`,
  sent: false,
});

export class OutreachSafety {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async suppression(address: string): Promise<Suppression | null> {
    const email = normalizeAddress(address);
    const domain = `@${email.split("@")[1] ?? ""}`;
    const row = await this.db
      .prepare(
        "SELECT address, reason, note, created_at FROM outreach_suppressions WHERE address IN (?, ?) ORDER BY length(address) DESC LIMIT 1",
      )
      .bind(email, domain)
      .first<{
        address: string;
        reason: SuppressionReason;
        note: string | null;
        created_at: number;
      }>();
    return row
      ? {
          address: row.address,
          reason: row.reason,
          note: row.note,
          createdAt: row.created_at,
        }
      : null;
  }

  /** Adding a suppression only ever narrows what can be drafted. */
  async suppress(
    target: string,
    reason: SuppressionReason,
    note?: string,
  ): Promise<Suppression> {
    const address = SuppressionTarget.parse(target);
    const createdAt = this.now();
    await this.db
      .prepare(
        "INSERT INTO outreach_suppressions (address, reason, note, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET reason = excluded.reason, note = excluded.note",
      )
      .bind(address, reason, note?.slice(0, 500) ?? null, createdAt)
      .run();
    return { address, reason, note: note ?? null, createdAt };
  }

  /** Operator only: runs from a confirmed staged card, never a model tool. */
  async unsuppress(target: string): Promise<boolean> {
    const address = SuppressionTarget.parse(target);
    const result = await this.db
      .prepare("DELETE FROM outreach_suppressions WHERE address = ?")
      .bind(address)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listSuppressions(limit = 50): Promise<Suppression[]> {
    const { results } = await this.db
      .prepare(
        "SELECT address, reason, note, created_at FROM outreach_suppressions ORDER BY created_at DESC LIMIT ?",
      )
      .bind(limit)
      .all<{
        address: string;
        reason: SuppressionReason;
        note: string | null;
        created_at: number;
      }>();
    return results.map((row) => ({
      address: row.address,
      reason: row.reason,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  async attempt(id: string): Promise<DraftAttempt | null> {
    const row = await this.db
      .prepare("SELECT * FROM outreach_draft_attempts WHERE id = ?")
      .bind(id)
      .first();
    return row ? toAttempt(row) : null;
  }

  async unresolvedAttempts(recipient?: string): Promise<DraftAttempt[]> {
    const { results } = await (
      recipient
        ? this.db
            .prepare(
              "SELECT * FROM outreach_draft_attempts WHERE state IN ('intent', 'unknown') AND recipient = ? ORDER BY created_at",
            )
            .bind(normalizeAddress(recipient))
        : this.db.prepare(
            "SELECT * FROM outreach_draft_attempts WHERE state IN ('intent', 'unknown') ORDER BY created_at DESC LIMIT 50",
          )
    ).all();
    return results.map(toAttempt);
  }

  private async setState(
    id: string,
    from: DraftAttempt["state"][],
    state: DraftAttempt["state"],
    draftId?: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE outreach_draft_attempts SET state = ?, draft_id = COALESCE(?, draft_id), updated_at = ? WHERE id = ? AND state IN (${from.map(() => "?").join(", ")})`,
      )
      .bind(state, draftId ?? null, this.now(), id, ...from)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  drafted(id: string, draftId: string) {
    return this.setState(id, ["intent", "unknown"], "drafted", draftId);
  }
  ambiguous(id: string) {
    return this.setState(id, ["intent"], "unknown");
  }
  /** The Gmail call was never made, so no draft can exist. */
  failed(id: string) {
    return this.setState(id, ["intent"], "failed");
  }
  /** Operator only: accepts the duplicate risk of drafting again. */
  abandon(id: string) {
    return this.setState(id, ["intent", "unknown"], "abandoned");
  }

  /**
   * Checks a draft against suppressions, unresolved attempts and the
   * recipient's Gmail history, then records the attempt. Returns the attempt
   * id to settle after the Gmail call, or why the draft is refused.
   */
  async guardDraft(
    request: DraftRequest,
    search: GmailSearch,
  ): Promise<{ state: "allowed"; attemptId: string } | DraftBlocked> {
    const recipient = normalizeAddress(request.recipientEmail);
    const suppressed = await this.suppression(recipient);
    if (suppressed)
      return blocked(
        "suppressed",
        `${recipient} is on the do-not-contact list (${suppressed.reason.replace(/_/g, " ")}${suppressed.address.startsWith("@") ? ` for ${suppressed.address}` : ""}${suppressed.note ? `: ${suppressed.note}` : ""}). Only the operator can lift this, on a confirmed card.`,
      );

    const read = async (query: string) => {
      try {
        return searchMessages(await search(query));
      } catch {
        return null;
      }
    };
    for (const attempt of await this.unresolvedAttempts(recipient)) {
      // One exact match resolves an attempt; zero or several stay with a human.
      const matches = await read(
        `in:drafts to:${recipient} subject:"${term(attempt.subject)}"`,
      );
      if (matches?.length === 1)
        await this.drafted(attempt.id, matches[0].messageId ?? "matched");
      else
        return blocked(
          "unresolved_attempt",
          `An earlier draft to ${recipient} (“${attempt.subject}”) has an unknown outcome. Check Gmail Drafts; if there is no draft, the operator can abandon attempt ${attempt.id} on a confirmed card, accepting that a duplicate draft may result.`,
        );
    }

    const [drafts, sent, received, bounces] = await Promise.all([
      read(`in:drafts to:${recipient}`),
      read(`in:sent to:${recipient}`),
      read(`from:${recipient}`),
      read(`from:(mailer-daemon OR postmaster) "${term(recipient)}"`),
    ]);
    if (!drafts || !sent || !received || !bounces)
      return blocked(
        "unverifiable",
        `Could not read ${recipient}'s history in Gmail, so this draft cannot be checked.`,
      );
    if (bounces.length) {
      await this.suppress(recipient, "bounced", "Bounce found in Gmail");
      return blocked(
        "bounced",
        `Mail to ${recipient} has bounced; the address is now suppressed.`,
      );
    }
    if (drafts.length)
      return blocked(
        "draft_exists",
        `A draft to ${recipient} already exists. Use or delete it in Gmail first.`,
      );
    let kind: DraftAttempt["kind"] = "cold";
    if (received.length) {
      if (!request.threadId || !threadsOf(received).has(request.threadId))
        return blocked(
          "replied",
          `${recipient} has written to you. Only a reply in one of their threads is allowed: ${[...threadsOf(received)].join(", ") || "none found"}.`,
        );
      kind = "reply";
    } else if (sent.length) {
      if (!request.threadId)
        return blocked(
          "already_contacted",
          `${recipient} was already emailed. A follow-up must continue the existing thread: ${[...threadsOf(sent)].join(", ")}.`,
        );
      if (!threadsOf(sent).has(request.threadId))
        return blocked(
          "thread_mismatch",
          `Thread ${request.threadId} is not one you sent to ${recipient}.`,
        );
      kind = "follow_up";
    } else if (request.threadId)
      return blocked(
        "thread_mismatch",
        `Nothing was sent to ${recipient} in thread ${request.threadId}.`,
      );

    const attemptId = crypto.randomUUID();
    const now = this.now();
    try {
      await this.db
        .prepare(
          "INSERT INTO outreach_draft_attempts (id, recipient, subject, thread_id, kind, state, draft_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'intent', NULL, ?, ?)",
        )
        .bind(
          attemptId,
          recipient,
          request.subject,
          request.threadId ?? null,
          kind,
          now,
          now,
        )
        .run();
    } catch {
      // The unique index admits one open attempt per recipient.
      return blocked(
        "unresolved_attempt",
        `Another draft to ${recipient} is in progress.`,
      );
    }
    return { state: "allowed", attemptId };
  }
}

const AttemptRow = z.object({
  id: z.string(),
  recipient: z.string(),
  subject: z.string(),
  thread_id: z.string().nullable(),
  kind: z.enum(["cold", "follow_up", "reply"]),
  state: z.enum(["intent", "drafted", "unknown", "failed", "abandoned"]),
  draft_id: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
function toAttempt(raw: unknown): DraftAttempt {
  const row = AttemptRow.parse(raw);
  return {
    id: row.id,
    recipient: row.recipient,
    subject: row.subject,
    threadId: row.thread_id,
    kind: row.kind,
    state: row.state,
    draftId: row.draft_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Runs one Gmail draft behind the guard: refuse, or record the attempt, make
 * the call, and settle the attempt from what the call proved. A failure
 * before the call leaves nothing in Gmail; after it, the draft may exist.
 */
export async function guardedCreateDraft<T>(
  safety: OutreachSafety,
  request: DraftRequest,
  gmail: { search: GmailSearch; create: () => Promise<T> },
): Promise<T | DraftBlocked> {
  const guard = await safety.guardDraft(request, gmail.search);
  if (guard.state === "blocked") return guard;
  try {
    const result = await gmail.create();
    const created = z.object({ draftId: z.string() }).safeParse(result);
    await safety.drafted(
      guard.attemptId,
      created.success ? created.data.draftId : "created",
    );
    return result;
  } catch (error) {
    const preDispatch =
      error instanceof Error &&
      /Connect Gmail first|reconnect required/.test(error.message);
    await (preDispatch
      ? safety.failed(guard.attemptId)
      : safety.ambiguous(guard.attemptId));
    throw error;
  }
}
