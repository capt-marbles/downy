import { expect, it, vi } from "vitest";
import { testDb } from "../../test/d1";
import { createCredentialRequest, resolveCredentialRequest } from "./requests";
import { encryptHeaders, decryptHeaders } from "./crypto";
import { buildHeaderTransport } from "../agent/mcp-reconnect";

it("keeps submitted values out of transcripts, tool results, logs, D1 and persisted transport", async () => {
  const db = testDb(["0010_credential_requests.sql"]);
  const logs = [
    vi.spyOn(console, "log"),
    vi.spyOn(console, "warn"),
    vi.spyOn(console, "error"),
  ];
  const secret = "private-test-key-not-for-model";
  const key = btoa("k".repeat(32));
  const ticket = await createCredentialRequest(db, "test", {
    purpose: "Connect",
    serverName: "test",
    url: "https://example.com/mcp",
    fields: [
      { headerName: "Authorization", label: "API key", scheme: "bearer" },
    ],
  });
  const transcript = [{ type: "tool-request_credential", output: ticket }];
  let persisted: unknown;
  const result = await resolveCredentialRequest(
    db,
    ticket.ticketId,
    "test",
    { Authorization: secret },
    async (_target, headers) => {
      expect(headers.Authorization).toBe(`Bearer ${secret}`);
      const envelope = await encryptHeaders(headers, key, "test:mcp");
      expect(await decryptHeaders(envelope, key, "test:mcp")).toEqual(headers);
      persisted = {
        envelope,
        transport: JSON.stringify(buildHeaderTransport("auto", headers)),
      };
      return { state: "ready", toolNames: ["search"], error: null };
    },
  );
  expect(result.state).toBe("ready");
  const rows = await db.prepare("SELECT * FROM credential_requests").all();
  const observable = JSON.stringify({
    transcript,
    result,
    persisted,
    rows,
    logs: logs.map((log) => log.mock.calls),
  });
  expect(observable).not.toContain(secret);
  logs.forEach((log) => log.mockRestore());
  const replay = await resolveCredentialRequest(
    db,
    ticket.ticketId,
    "test",
    { Authorization: secret },
    vi.fn(),
  );
  expect(replay.state).toBe("failed");
});
it("does not echo provider errors containing a credential", async () => {
  const db = testDb(["0010_credential_requests.sql"]);
  const ticket = await createCredentialRequest(db, "test", {
    purpose: "Connect",
    serverName: "test",
    url: "https://example.com/mcp",
    fields: [{ headerName: "x-api-key", label: "API key", scheme: "raw" }],
  });
  const result = await resolveCredentialRequest(
    db,
    ticket.ticketId,
    "test",
    { "x-api-key": "secret-value" },
    async () => {
      throw new Error("Rejected secret-value");
    },
  );
  expect(JSON.stringify(result)).not.toContain("secret-value");
  expect(result.state).toBe("failed");
});
