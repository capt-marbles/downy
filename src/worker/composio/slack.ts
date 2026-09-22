import {
  ConnectionSearchSchema as Search,
  activeAccounts,
  metaData,
  managedAuthorizationUrl,
  type ManagedCall as Call,
} from "./managed-protocol";
import { z } from "zod";
import {
  SlackPostMessageSchema,
  SlackReadActionSchema,
  type SlackConnectStatus,
  type SlackPostMessage,
  type SlackPostResult,
  type SlackReadAction,
} from "../../lib/slack-connect";

// Bot install: digests post as the app. Flip to "slack" for user identity.
const TOOLKIT = "slackbot";
const SLUG = {
  listChannels: "SLACKBOT_LIST_ALL_CHANNELS",
  sendMessage: "SLACKBOT_SEND_MESSAGE",
} as const;

export const SlackStateSchema = z.object({
  state: z.enum([
    "not_connected",
    "pending",
    "needs_selection",
    "ready",
    "failed",
    "expired",
  ]),
  accounts: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  sessionId: z.string().optional(),
  accountId: z.string().optional(),
  redirectUrl: z.string().optional(),
  expiresAt: z.number().optional(),
  identity: z.string().nullable().default(null),
  checkedAt: z.number().nullable().default(null),
  verifiedAt: z.number().optional(),
  verifiedSessionId: z.string().optional(),
});
export type SlackState = z.infer<typeof SlackStateSchema>;
const VERIFY_TTL_MS = 10 * 60_000;
const Managed = z.object({
  results: z.record(
    z.string(),
    z.object({
      toolkit: z.string(),
      status: z.enum(["active", "initiated", "failed"]),
      connected_account_id: z.string().nullish(),
      redirect_url: z.string().nullish(),
    }),
  ),
});

export class SlackConnection {
  constructor(
    private readonly call: Call,
    private readonly load: () => Promise<SlackState | undefined>,
    private readonly save: (state: SlackState) => Promise<void>,
    private readonly now = Date.now,
  ) {}
  private async search(state?: SlackState) {
    // The connection statuses only cover toolkits whose tools the search
    // surfaces. Generic Slack wording returns the user-OAuth `slack` toolkit,
    // so the use case must name the bot toolkit explicitly.
    const parsed = Search.safeParse(
      metaData(
        await this.call("COMPOSIO_SEARCH_TOOLS", {
          queries: [
            {
              use_case:
                "Using the slackbot toolkit, post a message to a Slack channel as a bot and list the workspace's channels",
            },
          ],
          session: state?.sessionId
            ? { id: state.sessionId }
            : { generate_id: true },
        }),
      ),
    );
    if (!parsed.success) {
      console.warn("Slack setup diagnostic", {
        stage: "search-shape",
        issues: parsed.error.issues.length,
      });
      throw new Error("Unexpected Slack status response");
    }
    const slack = parsed.data.toolkit_connection_statuses.find(
      (item) => item.toolkit === TOOLKIT,
    );
    if (!slack) {
      console.warn("Slack setup diagnostic", {
        stage: "toolkit-missing",
        toolkits: parsed.data.toolkit_connection_statuses.map(
          (item) => item.toolkit,
        ),
      });
      throw new Error("Slack status unavailable");
    }
    return { slack, sessionId: parsed.data.session.id };
  }
  async status(refresh = false): Promise<SlackConnectStatus> {
    let state = await this.load();
    if (!state && refresh) {
      const discovered = await this.search();
      state = {
        state: "not_connected",
        sessionId: discovered.sessionId,
        identity: null,
        checkedAt: this.now(),
      };
      await this.save(state);
    }
    // Viewing the card never starts authorization; only its Connect POST does.
    if (
      state &&
      refresh &&
      (!state.checkedAt || state.checkedAt < this.now() - 10_000)
    ) {
      const { slack, sessionId } = await this.search(state);
      state.sessionId = sessionId;
      state.checkedAt = this.now();
      if (slack.has_active_connection && state.state !== "not_connected") {
        const accounts = activeAccounts(slack, "Slack");
        const savedId = state.accountId;
        const selected = savedId
          ? accounts.find((account) => account.id === savedId)
          : accounts.length === 1
            ? accounts[0]
            : undefined;
        if (!selected) {
          state.state = "needs_selection";
          state.accounts = accounts;
          state.identity = null;
          delete state.redirectUrl;
        } else {
          state.identity = await this.identity(sessionId, selected);
          state.accountId = selected.id;
          state.state = "ready";
          delete state.accounts;
          delete state.redirectUrl;
          delete state.expiresAt;
        }
      } else if (state.expiresAt && state.expiresAt <= this.now()) {
        state.state = "expired";
        delete state.redirectUrl;
      } else if (state.state === "ready") state.state = "not_connected";
      await this.save(state);
    }
    state ??= { state: "not_connected", identity: null, checkedAt: null };
    return {
      state: state.state,
      identity: state.identity,
      checkedAt: state.checkedAt,
      authorized: false,
      ...(state.state === "needs_selection"
        ? { accounts: state.accounts ?? [] }
        : {}),
      error:
        state.state === "failed"
          ? "Slack authorization failed. Try again."
          : state.state === "expired"
            ? "Slack sign-in expired. Connect again."
            : null,
    };
  }
  async start(): Promise<{ redirectUrl: string | null }> {
    let state = await this.load();
    if (
      state?.state === "pending" &&
      state.redirectUrl &&
      (state.expiresAt ?? 0) > this.now()
    )
      return { redirectUrl: managedAuthorizationUrl(state.redirectUrl) };
    const { slack, sessionId } = await this.search(state);
    const accounts = activeAccounts(slack, "Slack");
    if (slack.has_active_connection) {
      if (accounts.length !== 1) {
        await this.save({
          state: "needs_selection",
          accounts,
          sessionId,
          identity: null,
          checkedAt: this.now(),
        });
        return { redirectUrl: null };
      }
      await this.save({
        state: "ready",
        sessionId,
        accountId: accounts[0].id,
        checkedAt: this.now(),
        identity: await this.identity(sessionId, accounts[0]),
      });
      return { redirectUrl: null };
    }
    const managed = Managed.parse(
      metaData(
        await this.call("COMPOSIO_MANAGE_CONNECTIONS", {
          toolkits: [TOOLKIT],
          reinitiate_all: false,
          session_id: sessionId,
        }),
      ),
    ).results[TOOLKIT];
    if (!managed || managed.status === "failed")
      throw new Error("Slack authorization failed");
    const redirectUrl = managed.redirect_url
      ? managedAuthorizationUrl(managed.redirect_url)
      : null;
    if (managed.status === "initiated" && !redirectUrl)
      throw new Error("Slack authorization link missing");
    state = {
      state: managed.status === "active" ? "ready" : "pending",
      sessionId,
      accountId: managed.connected_account_id ?? undefined,
      redirectUrl: redirectUrl ?? undefined,
      expiresAt: this.now() + 15 * 60_000,
      checkedAt: this.now(),
      identity: null,
    };
    if (state.state === "ready") {
      if (state.accountId)
        state.identity = await this.identity(sessionId, {
          id: state.accountId,
          label: `Slack account ${state.accountId.slice(-8)}`,
        });
      else {
        state.state = "pending";
        state.checkedAt = null;
      }
    }
    await this.save(state);
    return { redirectUrl };
  }
  async select(accountId: string): Promise<void> {
    const state = await this.load();
    if (!state || state.state !== "needs_selection")
      throw new Error("Slack selection unavailable");
    const { slack, sessionId } = await this.search(state);
    const account = activeAccounts(slack, "Slack").find(
      (entry) => entry.id === accountId,
    );
    if (!account) throw new Error("Slack account unavailable");
    await this.save({
      state: "ready",
      sessionId,
      accountId,
      identity: await this.identity(sessionId, account),
      checkedAt: this.now(),
    });
  }
  private async execute(
    sessionId: string,
    slug: string,
    args: Record<string, unknown>,
    accountId: string,
  ) {
    const data = z
      .object({
        results: z.array(
          z.object({
            tool_slug: z.string(),
            error: z.string().nullish(),
            response: z.unknown(),
          }),
        ),
      })
      .parse(
        metaData(
          await this.call("COMPOSIO_MULTI_EXECUTE_TOOL", {
            tools: [{ tool_slug: slug, arguments: args, account: accountId }],
            session_id: sessionId,
            sync_response_to_workbench: false,
            current_step:
              slug === SLUG.sendMessage ? "POSTING_MESSAGE" : "READING_SLACK",
          }),
        ),
      );
    const item = data.results[0];
    if (data.results.length !== 1 || item?.tool_slug !== slug || item.error)
      throw new Error("Slack action failed");
    const response = z
      .object({ successful: z.boolean(), data: z.unknown() })
      .parse(item.response);
    if (!response.successful) throw new Error("Slack action failed");
    return response.data;
  }
  /**
   * The bot toolkit exposes no whoami; a one-channel list proves the token
   * works and the account label names the workspace connection.
   */
  private async identity(
    sessionId: string,
    account: { id: string; label: string },
  ) {
    await this.execute(
      sessionId,
      SLUG.listChannels,
      { limit: 1, types: "public_channel", exclude_archived: true },
      account.id,
    );
    return account.label;
  }
  private async verified() {
    const state = await this.load();
    if (
      state?.state !== "ready" ||
      !state.sessionId ||
      !state.accountId ||
      !state.identity
    )
      throw new Error("Connect Slack first");
    if (
      state.verifiedSessionId &&
      typeof state.verifiedAt === "number" &&
      this.now() - state.verifiedAt < VERIFY_TTL_MS
    )
      return {
        sessionId: state.verifiedSessionId,
        accountId: state.accountId,
        identity: state.identity,
      };
    const found = await this.search(state);
    if (
      !found.slack.has_active_connection ||
      !activeAccounts(found.slack, "Slack").some(
        (account) => account.id === state.accountId,
      )
    )
      throw new Error("Slack account changed; reconnect required");
    await this.save({
      ...state,
      verifiedAt: this.now(),
      verifiedSessionId: found.sessionId,
    });
    return {
      sessionId: found.sessionId,
      accountId: state.accountId,
      identity: state.identity,
    };
  }
  async action(input: SlackReadAction) {
    const action = SlackReadActionSchema.parse(input);
    const { sessionId, accountId, identity } = await this.verified();
    const raw = await this.execute(
      sessionId,
      SLUG.listChannels,
      {
        limit: action.limit,
        types: "public_channel,private_channel",
        exclude_archived: true,
        ...(action.cursor ? { cursor: action.cursor } : {}),
      },
      accountId,
    );
    // Composio stores a large listing in a file even with inline responses
    // requested. Say so plainly; a Zod error loses its detail crossing the
    // Durable Object RPC boundary.
    if (
      raw &&
      typeof raw === "object" &&
      ("file_path" in raw || "storedInFile" in raw || "outputFilePath" in raw)
    )
      throw new Error(
        "Slack channel list too large to return inline; use a smaller limit and page with cursor",
      );
    const parsed = z
      .object({
        channels: z.array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            is_private: z.boolean().optional(),
            is_member: z.boolean().optional(),
          }),
        ),
        response_metadata: z
          .object({ next_cursor: z.string().optional() })
          .optional(),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new Error("Slack channel list had an unexpected shape");
    const data = parsed.data;
    return {
      account: identity,
      channels: data.channels.map((channel) => ({
        id: channel.id,
        name: channel.name ?? channel.id,
        private: channel.is_private ?? false,
        member: channel.is_member ?? false,
      })),
      nextCursor: data.response_metadata?.next_cursor || null,
    };
  }
  /** Never retried: a timeout may mean the message posted. */
  async post(input: SlackPostMessage): Promise<SlackPostResult> {
    const post = SlackPostMessageSchema.parse(input);
    const { sessionId, accountId, identity } = await this.verified();
    // Slack returns the timestamp at the top level or inside `message`;
    // accept either so a successful post is never reported as unknown.
    const data = z
      .object({
        ts: z.string().optional(),
        channel: z.string().optional(),
        message: z.object({ ts: z.string().optional() }).optional(),
      })
      .parse(
        await this.execute(
          sessionId,
          SLUG.sendMessage,
          { channel: post.channel, markdown_text: post.text },
          accountId,
        ),
      );
    const ts = data.ts ?? data.message?.ts;
    if (!ts) throw new Error("Slack post unconfirmed");
    return {
      state: "message_posted",
      account: identity,
      channel: data.channel ?? post.channel,
      ts,
    };
  }
}
