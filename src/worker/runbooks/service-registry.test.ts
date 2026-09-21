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
  expect(section).toContain("**Slack**: not connectable yet");
  expect(section).toContain("**TaskFuel**: cannot be connected");
  expect(section).toContain("connect_mcp_server (https://treg.to/mcp/)");
  expect(section).toContain(
    "unattended posting or writing to a connected service is not available",
  );
});
