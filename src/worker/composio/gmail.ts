import { z } from "zod";
import {
  GmailActionSchema,
  type GmailAction,
  type GmailConnectStatus,
} from "../../lib/gmail-connect";

export const GmailStateSchema = z.object({
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
  email: z.string().nullable().default(null),
  checkedAt: z.number().nullable().default(null),
});
export type GmailState = z.infer<typeof GmailStateSchema>;
type MetaName =
  | "COMPOSIO_SEARCH_TOOLS"
  | "COMPOSIO_MANAGE_CONNECTIONS"
  | "COMPOSIO_MULTI_EXECUTE_TOOL";
type Call = (name: MetaName, args: Record<string, unknown>) => Promise<unknown>;
const Search = z.object({
  toolkit_connection_statuses: z.array(
    z.object({
      toolkit: z.string(),
      has_active_connection: z.boolean(),
      accounts: z
        .array(
          z.object({
            id: z.string().min(1),
            status: z.string(),
            alias: z.string().nullish(),
            is_default: z.boolean().optional(),
            user_info: z
              .object({
                email: z.string().nullish(),
                emailAddress: z.string().nullish(),
              })
              .nullish(),
          }),
        )
        .optional(),
      connection_details: z
        .object({ connected_account_id: z.string().nullish() })
        .nullish()
        .transform((value) => value ?? {}),
    }),
  ),
  session: z.object({ id: z.string() }),
});
type GmailStatus = z.infer<
  typeof Search
>["toolkit_connection_statuses"][number];
function activeAccounts(gmail: GmailStatus) {
  if (!gmail.has_active_connection) return [];
  if (gmail.accounts) {
    const accounts = gmail.accounts
      .filter((account) => account.status.toLowerCase() === "active")
      .map((account) => ({
        id: account.id,
        isDefault: account.is_default === true,
        label: (
          account.user_info?.emailAddress ??
          account.user_info?.email ??
          account.alias ??
          `Gmail account ${account.id.slice(-8)}`
        ).slice(0, 200),
      }));
    return accounts.map(({ id, label, isDefault }) => ({
      id,
      label:
        accounts.filter((account) => account.label === label).length > 1
          ? `${label} (${isDefault ? "Composio default" : `connection ${id.slice(-6)}`})`
          : label,
    }));
  }
  const id = gmail.connection_details.connected_account_id;
  return id ? [{ id, label: `Gmail account ${id.slice(-8)}` }] : [];
}
const Managed = z.object({
  results: z.object({
    gmail: z.object({
      toolkit: z.literal("gmail"),
      status: z.enum(["active", "initiated", "failed"]),
      connected_account_id: z.string().nullish(),
      redirect_url: z.string().nullish(),
    }),
  }),
});

/** Decode only the documented MCP action envelope. Never forward vendor errors,
 * instructions, credentials, or setup payloads into the conversation. */
function metaData(value: unknown): unknown {
  const result = z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    })
    .parse(value);
  if (result.isError) {
    console.warn("Gmail setup diagnostic", { stage: "mcp-tool-error" });
    throw new Error("Composio request failed");
  }
  const payload: unknown =
    result.structuredContent ??
    JSON.parse(
      result.content?.find((part) => part.type === "text")?.text ?? "null",
    );
  const schema = z.object({ successful: z.boolean(), data: z.unknown() });
  const wrapper = schema.safeParse(payload);
  if (!wrapper.success) {
    const nested = z.object({ data: schema }).safeParse(payload);
    console.warn("Gmail setup diagnostic", {
      stage: nested.success ? "nested-envelope" : "unknown-envelope",
    });
    throw new Error("Unexpected Composio response");
  }
  if (!wrapper.data.successful) {
    console.warn("Gmail setup diagnostic", { stage: "provider-failure" });
    throw new Error("Composio request failed");
  }
  return wrapper.data.data;
}
function gmailAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ![
      "connect.composio.dev",
      "backend.composio.dev",
      "platform.composio.dev",
      "app.composio.dev",
    ].includes(url.hostname)
  )
    throw new Error("Unexpected authorization host");
  return url.toString();
}

export class GmailConnection {
  constructor(
    private readonly call: Call,
    private readonly load: () => Promise<GmailState | undefined>,
    private readonly save: (state: GmailState) => Promise<void>,
    private readonly now = Date.now,
  ) {}
  private async search(state?: GmailState) {
    const raw = metaData(
      await this.call("COMPOSIO_SEARCH_TOOLS", {
        queries: [{ use_case: "Get the connected Gmail account profile" }],
        session: state?.sessionId
          ? { id: state.sessionId }
          : { generate_id: true },
      }),
    );
    const parsed = Search.safeParse(raw);
    if (!parsed.success) {
      console.warn("Gmail setup diagnostic", {
        stage: "search-shape",
        fields: parsed.error.issues.map((issue) =>
          issue.path.filter(
            (part) =>
              typeof part === "string" &&
              [
                "toolkit_connection_statuses",
                "toolkit",
                "has_active_connection",
                "connection_details",
                "connected_account_id",
                "session",
                "id",
              ].includes(part),
          ),
        ),
        hasSession: z
          .object({ session: z.object({ id: z.string() }) })
          .safeParse(raw).success,
        hasConnections: z
          .object({ toolkit_connection_statuses: z.array(z.unknown()) })
          .safeParse(raw).success,
      });
      throw new Error("Unexpected Gmail status response");
    }
    const data = parsed.data;
    const gmail = data.toolkit_connection_statuses.find(
      (item) => item.toolkit === "gmail",
    );
    if (!gmail) throw new Error("Gmail status unavailable");
    return { gmail, sessionId: data.session.id };
  }
  async status(refresh = false): Promise<GmailConnectStatus> {
    let state = await this.load();
    if (!state && refresh) {
      const discovered = await this.search();
      state = {
        state: "not_connected",
        sessionId: discovered.sessionId,
        email: null,
        checkedAt: this.now(),
      };
      await this.save(state);
    }
    // Viewing a card never initiates authorization or attaches an existing
    // account. Only its Connect Gmail POST may start the managed flow.
    if (
      state &&
      refresh &&
      (!state.checkedAt || state.checkedAt < this.now() - 10_000)
    ) {
      const { gmail, sessionId } = await this.search(state);
      state.sessionId = sessionId;
      state.checkedAt = this.now();
      if (gmail.has_active_connection && state.state !== "not_connected") {
        const accounts = activeAccounts(gmail);
        const savedId = state.accountId;
        const selected = savedId
          ? accounts.find((account) => account.id === savedId)
          : accounts.length === 1
            ? accounts[0]
            : undefined;
        if (!selected) {
          // An active toolkit can contain several mailboxes. A provider default
          // is not the user's choice. Keep OAuth intact and ask in the card.
          state.state = "needs_selection";
          state.accounts = accounts;
          state.email = null;
          delete state.redirectUrl;
        } else {
          state.email = await this.profile(sessionId, selected.id);
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
    state ??= { state: "not_connected", email: null, checkedAt: null };
    return {
      state: state.state,
      email: state.email,
      checkedAt: state.checkedAt,
      authorized: false,
      ...(state.state === "needs_selection"
        ? { accounts: state.accounts ?? [] }
        : {}),
      error:
        state.state === "failed"
          ? "Gmail authorization failed. Try again."
          : state.state === "expired"
            ? "Gmail sign-in expired. Connect again."
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
      return { redirectUrl: gmailAuthorizationUrl(state.redirectUrl) };
    const { gmail, sessionId } = await this.search(state);
    const accounts = activeAccounts(gmail);
    if (gmail.has_active_connection) {
      if (accounts.length !== 1) {
        await this.save({
          state: "needs_selection",
          accounts,
          sessionId,
          email: null,
          checkedAt: this.now(),
        });
        return { redirectUrl: null };
      }
      await this.save({
        state: "ready",
        sessionId,
        accountId: accounts[0].id,
        checkedAt: this.now(),
        email: await this.profile(sessionId, accounts[0].id),
      });
      return { redirectUrl: null };
    }
    const managed = Managed.parse(
      metaData(
        await this.call("COMPOSIO_MANAGE_CONNECTIONS", {
          toolkits: ["gmail"],
          reinitiate_all: false,
          session_id: sessionId,
        }),
      ),
    ).results.gmail;
    if (managed.status === "failed")
      throw new Error("Gmail authorization failed");
    const redirectUrl = managed.redirect_url
      ? gmailAuthorizationUrl(managed.redirect_url)
      : null;
    if (managed.status === "initiated" && !redirectUrl)
      throw new Error("Gmail authorization link missing");
    state = {
      state: managed.status === "active" ? "ready" : "pending",
      sessionId,
      accountId: managed.connected_account_id ?? undefined,
      redirectUrl: redirectUrl ?? undefined,
      expiresAt: this.now() + 15 * 60_000,
      checkedAt: this.now(),
      email: null,
    };
    // An active response without a selected account still needs discovery.
    if (state.state === "ready") {
      if (state.accountId)
        state.email = await this.profile(sessionId, state.accountId);
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
      throw new Error("Gmail selection unavailable");
    const { gmail, sessionId } = await this.search(state);
    if (!activeAccounts(gmail).some((account) => account.id === accountId))
      throw new Error("Gmail account unavailable");
    const email = await this.profile(sessionId, accountId);
    await this.save({
      state: "ready",
      sessionId,
      accountId,
      email,
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
              slug === "GMAIL_CREATE_EMAIL_DRAFT"
                ? "CREATING_DRAFT"
                : "READING_GMAIL",
          }),
        ),
      );
    const item = data.results[0];
    if (data.results.length !== 1 || item?.tool_slug !== slug || item.error)
      throw new Error("Gmail action failed");
    const response = z
      .object({ successful: z.boolean(), data: z.unknown() })
      .parse(item.response);
    if (!response.successful) throw new Error("Gmail action failed");
    return response.data;
  }
  private async profile(sessionId: string, accountId: string) {
    return z
      .object({ emailAddress: z.string().email() })
      .parse(
        await this.execute(
          sessionId,
          "GMAIL_GET_PROFILE",
          { user_id: "me" },
          accountId,
        ),
      ).emailAddress;
  }
  async action(input: GmailAction) {
    const action = GmailActionSchema.parse(input);
    const state = await this.load();
    if (
      state?.state !== "ready" ||
      !state.sessionId ||
      !state.accountId ||
      !state.email
    )
      throw new Error("Connect Gmail first");
    // Check the selected account before every action. Never silently switch to
    // another mailbox when the Composio account's default connection changes.
    const found = await this.search(state);
    if (
      !found.gmail.has_active_connection ||
      !activeAccounts(found.gmail).some(
        (account) => account.id === state.accountId,
      ) ||
      (await this.profile(found.sessionId, state.accountId)) !== state.email
    )
      throw new Error("Gmail account changed; reconnect required");
    if (action.action === "create_draft") {
      // No retry: a timeout may mean a draft was created. The caller must search
      // Drafts to reconcile before trying again, rather than creating duplicates.
      const draft = z
        .object({
          id: z.string(),
          message: z.object({ id: z.string() }).optional(),
        })
        .parse(
          await this.execute(
            found.sessionId,
            "GMAIL_CREATE_EMAIL_DRAFT",
            {
              user_id: "me",
              recipient_email: action.recipientEmail,
              subject: action.subject,
              body: action.body,
              is_html: false,
              ...(action.threadId ? { thread_id: action.threadId } : {}),
            },
            state.accountId,
          ),
        );
      return {
        state: "draft_created",
        account: state.email,
        draftId: draft.id,
        messageId: draft.message?.id,
        url: "https://mail.google.com/mail/u/0/#drafts",
        sent: false,
      };
    }
    const result = await this.execute(
      found.sessionId,
      action.action === "search"
        ? "GMAIL_FETCH_EMAILS"
        : "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      action.action === "search"
        ? {
            user_id: "me",
            query: action.query,
            max_results: action.limit,
            include_payload: false,
            verbose: false,
          }
        : { user_id: "me", message_id: action.messageId },
      state.accountId,
    );
    return { account: state.email, data: result };
  }
}
