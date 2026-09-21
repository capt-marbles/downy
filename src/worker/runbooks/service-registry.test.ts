import { expect, it } from "vitest";
import { renderConnectionsSection, resolveService } from "./service-registry";

it("resolves the services the runbook knows and nothing else", () => {
  expect(resolveService("Connect Gmail")?.id).toBe("gmail");
  expect(resolveService("can you connect to Slack?")?.id).toBe("slack");
  expect(resolveService("slackbot")?.id).toBe("slack");
  expect(resolveService("hook up Treg")?.id).toBe("treg");
  expect(resolveService("task fuel")?.id).toBe("taskfuel");
  expect(resolveService("HubSpot")).toBeNull();
});

it("renders code-owned truth about what can be connected", () => {
  const section = renderConnectionsSection();
  expect(section).toContain("**Slack**: secure card in chat");
  expect(section).toContain(
    "**Slack**: secure card in chat via find_tool_setup. Usable from chat and voice.",
  );
  expect(section).toContain(
    "**Gmail**: secure card in chat via find_tool_setup. Usable from chat.",
  );
  expect(section).not.toContain("**TaskFuel**: cannot be connected. Usable");
  expect(section).toContain("**TaskFuel**: cannot be connected");
  expect(section).toContain("connect_mcp_server (https://treg.to/mcp/)");
  expect(section).toContain("standing approvals");
  expect(section).toContain("no per-run confirmation is needed");
});
