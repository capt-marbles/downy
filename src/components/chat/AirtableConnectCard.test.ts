import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import AirtableConnectCard from "./AirtableConnectCard";
import type { AirtableConnectStatus } from "../../lib/airtable-connect";
vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
function render(status: AirtableConnectStatus) {
  const client = new QueryClient();
  client.setQueryData(["airtable-connect", "test"], status);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AirtableConnectCard),
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
  expect(html).toContain("Connect Airtable");
  expect(html).toContain("/api/composio/oauth/airtable/start?agentSlug=test");
  expect(html).toContain('method="post"');
  expect(html).toContain("cannot create, update or delete");
});
it("shows account choice and requires the bot grant before reporting connected", () => {
  const status: AirtableConnectStatus = {
    state: "ready",
    identity: "owner@example.com",
    authorized: true,
    error: null,
    checkedAt: 1,
  };
  expect(render(status)).toContain("Connected as owner@example.com");
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
  expect(html).not.toContain("/airtable/start");
  expect(html).not.toContain("drafts");
});
