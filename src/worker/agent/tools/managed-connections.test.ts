import { expect, it, vi } from "vitest";
import { createFindToolSetupTool } from "./tool-setup";
import {
  createConnectMcpServerTool,
  createListMcpServersTool,
} from "./mcp-servers";
import type { DownyAgent } from "../DownyAgent";
function fixture() {
  const managed = {
    composio: { state: "connected" },
    gmail: { state: "not_connected" },
  };
  const stub = {
    showGmailConnectCard: vi.fn(),
    showAirtableConnectCard: vi.fn(),
    findManagedToolSetup: vi.fn(),
    showComposioConnectCard: vi.fn(),
    managedConnectionStatus: vi.fn(async () => managed),
    getMcpServers: () => ({ servers: {}, tools: [] }),
    connectMcpEndpoint: vi.fn(),
  };
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- only the tested RPC methods are required.
  const agent = stub as unknown as DownyAgent;
  return { agent, stub, managed };
}
const options = { toolCallId: "test", messages: [] };
it("Airtable setup displays a persistent OAuth card without asking for credentials or probing an endpoint", async () => {
  const f = fixture();
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- confirmed Airtable path needs no bindings.
  const setup = createFindToolSetupTool({} as Cloudflare.Env, f.agent);
  const result = await setup.execute!({ query: "Connect Airtable" }, options);
  expect(f.stub.showAirtableConnectCard).toHaveBeenCalledOnce();
  expect(f.stub.connectMcpEndpoint).not.toHaveBeenCalled();
  expect(result).toMatchObject({ candidates: [{ toolkit: "airtable" }] });
  expect(JSON.stringify(result)).toContain("Stop and wait");
});
it("the conversation's Gmail setup tool displays a card with an explicit wait instruction, without connecting", async () => {
  const f = fixture();
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- known Gmail discovery does not use bindings.
  const tool = createFindToolSetupTool({} as Cloudflare.Env, f.agent);
  const result = await tool.execute!(
    { query: "Connect my Gmail for reading and drafts" },
    options,
  );
  expect(result).toMatchObject({
    managedConnections: f.managed,
  });
  expect(JSON.stringify(result)).toContain("Stop and wait");
  expect(f.stub.showGmailConnectCard).toHaveBeenCalledOnce();
  expect(f.stub.connectMcpEndpoint).not.toHaveBeenCalled();
});
it("an empty MCP list still reports connected managed OAuth, and guessed Composio URLs cannot start a retry ladder", async () => {
  const f = fixture();
  const list = createListMcpServersTool({ agent: f.agent });
  expect(await list.execute!({}, options)).toEqual({
    servers: [],
    managedConnections: f.managed,
  });
  const connect = createConnectMcpServerTool({ agent: f.agent });
  const result = await connect.execute!(
    { name: "composio", url: "https://mcp.composio.dev/sse" },
    options,
  );
  expect(result).toMatchObject({
    state: "managed",
    managedConnections: f.managed,
  });
  expect(f.stub.connectMcpEndpoint).not.toHaveBeenCalled();
});
