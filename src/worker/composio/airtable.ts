import { readOffloadedAirtableSchema } from "./airtable-schema";
import {
  airtableFailure,
  airtableDiagnostic,
  airtableErrorCode,
  schemaReadSummary,
} from "./airtable-diagnostics";
import { z } from "zod";
import {
  AirtableReadActionSchema,
  type AirtableReadAction,
  type AirtableConnectStatus,
} from "../../lib/airtable-connect";
import {
  ConnectionSearchSchema,
  activeAccounts,
  metaData,
  managedAuthorizationUrl,
  type ManagedCall,
} from "./managed-protocol";

export const AirtableStateSchema = z.object({
  state: z.enum([
    "not_connected",
    "pending",
    "needs_selection",
    "ready",
    "expired",
  ]),
  sessionId: z.string(),
  accountId: z.string().optional(),
  identity: z.string().nullable().default(null),
  accounts: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  redirectUrl: z.string().optional(),
  expiresAt: z.number().optional(),
  checkedAt: z.number().nullable(),
});
type State = z.infer<typeof AirtableStateSchema>;
export class AirtableConnection {
  constructor(
    private readonly call: ManagedCall,
    private readonly load: () => Promise<State | undefined>,
    private readonly save: (state: State) => Promise<void>,
    private readonly now = Date.now,
  ) {}
  private async search(state?: State) {
    const data = ConnectionSearchSchema.parse(
      metaData(
        await this.call("COMPOSIO_SEARCH_TOOLS", {
          queries: [
            {
              use_case:
                "Get Airtable user information and list accessible bases",
            },
          ],
          session: state ? { id: state.sessionId } : { generate_id: true },
        }),
      ),
    );
    const toolkit = data.toolkit_connection_statuses.find(
      (item) => item.toolkit === "airtable",
    );
    if (!toolkit) throw new Error("Airtable discovery unavailable");
    return {
      sessionId: data.session.id,
      accounts: activeAccounts(toolkit, "Airtable"),
    };
  }
  private async execute(
    sessionId: string,
    accountId: string,
    slug: string,
    args: Record<string, unknown>,
  ) {
    let raw: unknown;
    try {
      raw = await this.call("COMPOSIO_MULTI_EXECUTE_TOOL", {
        tools: [{ tool_slug: slug, arguments: args, account: accountId }],
        session_id: sessionId,
        sync_response_to_workbench: false,
        current_step: "READING_AIRTABLE",
      });
    } catch (error) {
      throw airtableFailure(error);
    }
    let decoded: unknown;
    try {
      decoded = metaData(raw);
    } catch {
      throw airtableFailure(raw);
    }
    const parsed = z
      .object({
        remote_file_info: z.unknown().optional(),
        results: z.array(
          z.object({
            tool_slug: z.string(),
            error: z.unknown().optional(),
            response: z.unknown(),
          }),
        ),
      })
      .safeParse(decoded);
    if (!parsed.success)
      throw airtableFailure(decoded, "response_invalid", "execution_envelope");
    const data = parsed.data;
    const item = data.results[0];
    if (data.results.length !== 1 || item?.tool_slug !== slug || item.error)
      throw airtableFailure(item ?? data);
    const response = z
      .object({ successful: z.literal(true), data: z.json() })
      .safeParse(item.response);
    if (!response.success) {
      const success = z
        .object({ successful: z.literal(true) })
        .safeParse(item.response);
      if (
        slug === "AIRTABLE_GET_BASE_SCHEMA" &&
        success.success &&
        data.remote_file_info
      )
        return readOffloadedAirtableSchema(
          this.call,
          sessionId,
          data.remote_file_info,
        );
      throw airtableFailure(
        { ...data, response: item.response },
        "response_invalid",
        "tool_response",
      );
    }
    return response.data.data;
  }
  private async profile(sessionId: string, accountId: string) {
    const profile = z
      .object({ id: z.string().min(1), email: z.string().email().nullish() })
      .parse(
        await this.execute(sessionId, accountId, "AIRTABLE_GET_USER_INFO", {}),
      );
    // Email is optional when user.email:read was not granted. The stable user
    // ID is always retained so an account cannot silently change identity.
    return profile.email ? `${profile.email} (${profile.id})` : profile.id;
  }
  private async ready(sessionId: string, accountId: string) {
    const state: State = {
      state: "ready",
      sessionId,
      accountId,
      identity: await this.profile(sessionId, accountId),
      checkedAt: this.now(),
    };
    await this.save(state);
    return state;
  }
  async status(refresh = false): Promise<AirtableConnectStatus> {
    let state = await this.load();
    if (
      refresh &&
      (!state || !state.checkedAt || state.checkedAt < this.now() - 10_000)
    ) {
      const found = await this.search(state);
      if (!state)
        state = {
          state: "not_connected",
          sessionId: found.sessionId,
          identity: null,
          checkedAt: this.now(),
        };
      else if (state.state !== "not_connected" && found.accounts.length) {
        const pinned = state.accountId;
        const selected = pinned
          ? found.accounts.find((account) => account.id === pinned)
          : found.accounts.length === 1
            ? found.accounts[0]
            : undefined;
        if (selected) state = await this.ready(found.sessionId, selected.id);
        else
          state = {
            state: "needs_selection",
            sessionId: found.sessionId,
            identity: null,
            accounts: found.accounts,
            checkedAt: this.now(),
          };
      } else if (state.state === "ready")
        state = {
          state: "not_connected",
          sessionId: found.sessionId,
          identity: null,
          checkedAt: this.now(),
        };
      else if (state.expiresAt && state.expiresAt <= this.now()) {
        state.state = "expired";
        delete state.redirectUrl;
      }
      state.checkedAt = this.now();
      await this.save(state);
    }
    return {
      state: state?.state ?? "not_connected",
      identity: state?.identity ?? null,
      checkedAt: state?.checkedAt ?? null,
      authorized: false,
      error:
        state?.state === "expired"
          ? "Airtable sign-in expired. Connect again."
          : null,
      ...(state?.state === "needs_selection"
        ? { accounts: state.accounts ?? [] }
        : {}),
    };
  }
  async start(): Promise<{ redirectUrl: string | null }> {
    const state = await this.load();
    if (
      state?.state === "pending" &&
      state.redirectUrl &&
      (state.expiresAt ?? 0) > this.now()
    )
      return { redirectUrl: managedAuthorizationUrl(state.redirectUrl) };
    const found = await this.search(state);
    if (found.accounts.length) {
      if (found.accounts.length === 1)
        await this.ready(found.sessionId, found.accounts[0].id);
      else
        await this.save({
          state: "needs_selection",
          sessionId: found.sessionId,
          identity: null,
          accounts: found.accounts,
          checkedAt: this.now(),
        });
      return { redirectUrl: null };
    }
    const managed = z
      .object({
        results: z.object({
          airtable: z.object({
            toolkit: z.literal("airtable"),
            status: z.enum(["active", "initiated", "failed"]),
            connected_account_id: z.string().nullish(),
            redirect_url: z.string().nullish(),
          }),
        }),
      })
      .parse(
        metaData(
          await this.call("COMPOSIO_MANAGE_CONNECTIONS", {
            toolkits: ["airtable"],
            session_id: found.sessionId,
          }),
        ),
      ).results.airtable;
    if (managed.status === "failed")
      throw new Error("Airtable authorization failed");
    if (managed.status === "active" && managed.connected_account_id) {
      await this.ready(found.sessionId, managed.connected_account_id);
      return { redirectUrl: null };
    }
    const redirectUrl = managed.redirect_url
      ? managedAuthorizationUrl(managed.redirect_url)
      : null;
    if (managed.status === "initiated" && !redirectUrl)
      throw new Error("Authorization link missing");
    await this.save({
      state: "pending",
      sessionId: found.sessionId,
      accountId: managed.connected_account_id ?? undefined,
      identity: null,
      redirectUrl: redirectUrl ?? undefined,
      expiresAt: this.now() + 15 * 60_000,
      checkedAt: null,
    });
    return { redirectUrl };
  }
  async select(accountId: string) {
    const state = await this.load();
    if (state?.state !== "needs_selection")
      throw new Error("Airtable selection unavailable");
    const found = await this.search(state);
    if (!found.accounts.some((account) => account.id === accountId))
      throw new Error("Airtable account unavailable");
    await this.ready(found.sessionId, accountId);
  }
  async checkSchema(baseId: string) {
    try {
      const result = await this.action({ action: "get_schema", baseId });
      return schemaReadSummary(result.data);
    } catch (error) {
      return {
        state: "failed" as const,
        operation: "get_schema" as const,
        code: airtableErrorCode(error),
        diagnostic: airtableDiagnostic(error),
      };
    }
  }
  async action(input: AirtableReadAction) {
    const action = AirtableReadActionSchema.parse(input);
    const state = await this.load();
    if (state?.state !== "ready" || !state.accountId || !state.identity)
      throw new Error("Connect Airtable first");
    const found = await this.search(state);
    if (
      !found.accounts.some((account) => account.id === state.accountId) ||
      (await this.profile(found.sessionId, state.accountId)) !== state.identity
    )
      throw new Error("Airtable account changed; verify the connection card");
    const slug =
      action.action === "list_bases"
        ? "AIRTABLE_LIST_BASES"
        : action.action === "get_schema"
          ? "AIRTABLE_GET_BASE_SCHEMA"
          : "AIRTABLE_LIST_RECORDS";
    const args =
      action.action === "list_bases"
        ? { offset: action.offset }
        : action.action === "get_schema"
          ? { baseId: action.baseId }
          : {
              baseId: action.baseId,
              tableIdOrName: action.tableId,
              pageSize: action.limit,
              offset: action.offset,
              fields: action.fields,
              filterByFormula: action.filterByFormula,
            };
    return {
      account: state.identity,
      data: await this.execute(found.sessionId, state.accountId, slug, args),
    };
  }
}
