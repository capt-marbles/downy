import { expect, it } from "vitest";
import { testDb } from "../../test/d1";
import {
  StagedActionPayloadSchema,
  describeStagedAction,
} from "../../lib/staged-actions";
import {
  guardedCreateDraft,
  OutreachSafety,
  searchMessages,
  type GmailSearch,
} from "./outreach-safety";

const lead = "Lead@Studio.example";
const address = "lead@studio.example";
const msg = (threadId: string) => ({ messageId: `m-${threadId}`, threadId });

/** A Gmail history: which messages each kind of search returns. */
function gmail(history: {
  drafts?: string[];
  sent?: string[];
  received?: string[];
  bounces?: string[];
  reconcile?: string[];
  fail?: boolean;
}): GmailSearch & { queries: string[] } {
  const queries: string[] = [];
  const search = async (query: string) => {
    queries.push(query);
    if (history.fail) throw new Error("Gmail unavailable");
    const threads = query.includes("subject:")
      ? history.reconcile
      : query.startsWith("in:drafts")
        ? history.drafts
        : query.startsWith("in:sent")
          ? history.sent
          : query.includes("mailer-daemon")
            ? history.bounces
            : history.received;
    return {
      account: "me@gameye.example",
      data: { messages: (threads ?? []).map(msg), resultSizeEstimate: 0 },
    };
  };
  return Object.assign(search, { queries });
}
const safety = () =>
  new OutreachSafety(testDb(["0019_outreach_safety.sql"]), () => 1_000);

it("reads Gmail search results in every shape Composio returns, and refuses unknown shapes", () => {
  expect(
    searchMessages({ account: "a", data: { messages: [msg("t1")] } }),
  ).toEqual([{ messageId: "m-t1", threadId: "t1" }]);
  expect(searchMessages({ data: { data: { messages: [msg("t2")] } } })).toEqual(
    [{ messageId: "m-t2", threadId: "t2" }],
  );
  expect(searchMessages({ data: { resultSizeEstimate: 0 } })).toEqual([]);
  expect(searchMessages({ messages: [] })).toEqual([]);
  expect(searchMessages({ data: { unexpected: true } })).toBeNull();
  expect(searchMessages("text")).toBeNull();
});

it("a cold draft to a new address is allowed and recorded before the Gmail call", async () => {
  const s = safety();
  const decision = await s.guardDraft(
    { recipientEmail: lead, subject: "servers for the playtest?" },
    gmail({}),
  );
  expect(decision.state).toBe("allowed");
  if (decision.state !== "allowed") return;
  expect(await s.attempt(decision.attemptId)).toMatchObject({
    recipient: address,
    kind: "cold",
    state: "intent",
  });
  expect(await s.drafted(decision.attemptId, "r-123")).toBe(true);
  expect(await s.attempt(decision.attemptId)).toMatchObject({
    state: "drafted",
    draftId: "r-123",
  });
});

it("suppressions block an address or a whole domain until the operator lifts them", async () => {
  const s = safety();
  await s.suppress(address, "opt_out", "asked to be removed");
  expect(
    await s.guardDraft({ recipientEmail: lead, subject: "x" }, gmail({})),
  ).toMatchObject({ state: "blocked", code: "suppressed", sent: false });
  expect(await s.unsuppress(address)).toBe(true);
  await s.suppress("@Studio.example", "do_not_contact");
  const blocked = await s.guardDraft(
    { recipientEmail: "ceo@studio.example", subject: "x" },
    gmail({}),
  );
  expect(blocked).toMatchObject({ code: "suppressed" });
  expect(blocked.state === "blocked" && blocked.reason).toContain(
    "@studio.example",
  );
  await expect(s.suppress("not an address", "manual")).rejects.toThrow();
  expect(await s.unresolvedAttempts()).toEqual([]);
});

it("recipient history decides: one draft at a time, follow-ups continue their thread, replies stay in theirs", async () => {
  const draft = { recipientEmail: lead, subject: "x" };
  expect(
    await safety().guardDraft(draft, gmail({ drafts: ["d1"] })),
  ).toMatchObject({ code: "draft_exists" });
  expect(
    await safety().guardDraft(draft, gmail({ sent: ["t1"] })),
  ).toMatchObject({ code: "already_contacted" });
  expect(
    await safety().guardDraft(
      { ...draft, threadId: "t9" },
      gmail({ sent: ["t1"] }),
    ),
  ).toMatchObject({ code: "thread_mismatch" });
  expect(
    await safety().guardDraft({ ...draft, threadId: "t1" }, gmail({})),
  ).toMatchObject({ code: "thread_mismatch" });
  const s = safety();
  const followUp = await s.guardDraft(
    { ...draft, threadId: "t1" },
    gmail({ sent: ["t1"] }),
  );
  expect(followUp.state).toBe("allowed");
  if (followUp.state === "allowed")
    expect((await s.attempt(followUp.attemptId))?.kind).toBe("follow_up");
  expect(
    await safety().guardDraft(
      { ...draft, threadId: "t1" },
      gmail({ sent: ["t1"], received: ["t2"] }),
    ),
  ).toMatchObject({ code: "replied" });
  const replier = safety();
  const reply = await replier.guardDraft(
    { ...draft, threadId: "t2" },
    gmail({ sent: ["t1"], received: ["t2"] }),
  );
  expect(reply.state).toBe("allowed");
  if (reply.state === "allowed")
    expect((await replier.attempt(reply.attemptId))?.kind).toBe("reply");
});

it("a bounce blocks and suppresses the address; unreadable history blocks without recording", async () => {
  const s = safety();
  expect(
    await s.guardDraft(
      { recipientEmail: lead, subject: "x" },
      gmail({ bounces: ["b1"] }),
    ),
  ).toMatchObject({ code: "bounced" });
  expect(await s.suppression(address)).toMatchObject({ reason: "bounced" });

  const unreadable = safety();
  expect(
    await unreadable.guardDraft(
      { recipientEmail: lead, subject: "x" },
      gmail({ fail: true }),
    ),
  ).toMatchObject({ code: "unverifiable" });
  expect(await unreadable.unresolvedAttempts()).toEqual([]);
});

it("an unknown outcome blocks the recipient until exactly one matching draft is found or the operator abandons it", async () => {
  const s = safety();
  const draft = { recipientEmail: lead, subject: "servers?" };
  const first = await s.guardDraft(draft, gmail({}));
  if (first.state !== "allowed") throw new Error("expected allowed");
  await s.ambiguous(first.attemptId);

  const history = gmail({ reconcile: [] });
  expect(await s.guardDraft(draft, history)).toMatchObject({
    code: "unresolved_attempt",
  });
  expect(history.queries[0]).toBe(`in:drafts to:${address} subject:"servers?"`);
  expect(
    await s.guardDraft(draft, gmail({ reconcile: ["d1", "d2"] })),
  ).toMatchObject({ code: "unresolved_attempt" });

  // One exact match: the earlier attempt did create the draft.
  expect(
    await s.guardDraft(draft, gmail({ reconcile: ["d1"], drafts: ["d1"] })),
  ).toMatchObject({ code: "draft_exists" });
  expect((await s.attempt(first.attemptId))?.state).toBe("drafted");

  const other = safety();
  const lost = await other.guardDraft(draft, gmail({}));
  if (lost.state !== "allowed") throw new Error("expected allowed");
  await other.ambiguous(lost.attemptId);
  expect(await other.abandon(lost.attemptId)).toBe(true);
  expect((await other.guardDraft(draft, gmail({}))).state).toBe("allowed");
});

it("allows one open attempt per recipient even when drafts race, and a pre-call failure closes it", async () => {
  const s = safety();
  const draft = { recipientEmail: lead, subject: "x" };
  const results = await Promise.all([
    s.guardDraft(draft, gmail({})),
    s.guardDraft(draft, gmail({})),
  ]);
  expect(results.filter((r) => r.state === "allowed")).toHaveLength(1);
  expect(results.filter((r) => r.state === "blocked")).toHaveLength(1);
  const allowed = results.find((r) => r.state === "allowed");
  if (allowed?.state !== "allowed") throw new Error("expected allowed");
  expect(await s.failed(allowed.attemptId)).toBe(true);
  expect(await s.ambiguous(allowed.attemptId)).toBe(false);
  expect((await s.guardDraft(draft, gmail({}))).state).toBe("allowed");
});

it("lifting a suppression and abandoning an attempt are staged cards the operator confirms", () => {
  const lift = StagedActionPayloadSchema.parse({
    kind: "outreach_unsuppress",
    outreachUnsuppress: { address, reason: "They asked to hear back in Q4" },
  });
  expect(describeStagedAction(lift).title).toBe(
    `Allow drafting to ${address} again`,
  );
  const abandon = StagedActionPayloadSchema.parse({
    kind: "outreach_abandon",
    outreachAbandon: {
      attemptId: crypto.randomUUID(),
      recipient: address,
      subject: "servers?",
    },
  });
  expect(describeStagedAction(abandon).lines.join(" ")).toContain(
    "may duplicate",
  );
  expect(() =>
    StagedActionPayloadSchema.parse({
      kind: "outreach_abandon",
      outreachAbandon: {
        attemptId: "x",
        recipient: address,
        subject: "s",
        extra: 1,
      },
    }),
  ).toThrow();
});

it("the draft wrapper settles each attempt from what the Gmail call proved", async () => {
  const s = safety();
  const request = { recipientEmail: lead, subject: "x" };
  let calls = 0;
  const created = await guardedCreateDraft(s, request, {
    search: gmail({}),
    create: async () => {
      calls++;
      return { state: "draft_created", draftId: "r-1" };
    },
  });
  expect(created).toMatchObject({ draftId: "r-1" });
  expect((await s.unresolvedAttempts()).length).toBe(0);

  // Refused before Gmail: the create call never happens.
  const refused = await guardedCreateDraft(s, request, {
    search: gmail({ drafts: ["d1"] }),
    create: async () => {
      calls++;
      return {};
    },
  });
  expect(refused).toMatchObject({ state: "blocked", code: "draft_exists" });
  expect(calls).toBe(1);

  // Failing before dispatch closes the attempt; failing after leaves it unknown.
  const other = { recipientEmail: "b@studio.example", subject: "y" };
  await expect(
    guardedCreateDraft(s, other, {
      search: gmail({}),
      create: async () => {
        throw new Error("Connect Gmail first");
      },
    }),
  ).rejects.toThrow();
  expect(await s.unresolvedAttempts("b@studio.example")).toEqual([]);
  await expect(
    guardedCreateDraft(s, other, {
      search: gmail({}),
      create: async () => {
        throw new Error("Gmail action failed");
      },
    }),
  ).rejects.toThrow();
  expect(
    (await s.unresolvedAttempts("b@studio.example")).map((a) => a.state),
  ).toEqual(["unknown"]);
});
