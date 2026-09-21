import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import SlackConnectCard from "./SlackConnectCard";
import type { SlackConnectStatus } from "../../lib/slack-connect";
vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
function render(status: SlackConnectStatus) {
  const client = new QueryClient();
  client.setQueryData(["slack-connect", "test"], status);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SlackConnectCard),
    ),
  );
  client.clear();
  return html;
}
it("renders a scoped connect button instead of asking for an endpoint or key", () => {
  const html = render({
    state: "not_connected",
    identity: null,
    authorized: false,
    error: null,
    checkedAt: null,
  });
  expect(html).toContain("Connect Slack");
  expect(html).toContain("/api/composio/oauth/slack/start?agentSlug=test");
  expect(html).toContain('method="post"');
  expect(html).toContain("Downy never reads messages");
  expect(html).toContain("through a card you tap");
});
it("shows account choice and requires the bot grant before reporting connected", () => {
  const status: SlackConnectStatus = {
    state: "ready",
    identity: "owner@example.com",
    authorized: true,
    error: null,
    checkedAt: 1,
  };
  expect(render(status)).toContain("Connected (owner@example.com)");
  expect(render({ ...status, authorized: false })).not.toContain(
    "Connected as",
  );
  const html = render({
    ...status,
    state: "needs_selection",
    identity: null,
    accounts: [
      { id: "one", label: "Work" },
      { id: "two", label: "Personal" },
    ],
  });
  expect(html).toContain("Use Work");
  expect(html).not.toContain("/gmail/start");
  expect(html).not.toContain("drafts");
});
