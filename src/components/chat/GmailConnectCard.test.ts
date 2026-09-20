import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import GmailConnectCard from "./GmailConnectCard";
import type { GmailConnectStatus } from "../../lib/gmail-connect";

vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
function render(status: GmailConnectStatus) {
  const client = new QueryClient();
  client.setQueryData(["gmail-connect", "test"], status);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(GmailConnectCard),
    ),
  );
  client.clear();
  return html;
}
it("shows mailbox choices after consent without another sign-in or a false failure", () => {
  const html = render({
    state: "needs_selection",
    authorized: true,
    email: null,
    checkedAt: 1,
    error: null,
    accounts: [
      { id: "one", label: "work@example.com" },
      { id: "two", label: "personal@example.com" },
    ],
  });
  expect(html).toContain("Gmail is authorized");
  expect(html).toContain("Use work@example.com");
  expect(html).toContain("Use personal@example.com");
  expect(html).not.toContain("/gmail/start");
  expect(html).not.toContain("Could not");
  expect(html).not.toContain("Connected as");
});
it("reports ready only for a verified account granted to this bot", () => {
  const status: GmailConnectStatus = {
    state: "ready",
    authorized: true,
    email: "work@example.com",
    checkedAt: 1,
    error: null,
  };
  expect(render(status)).toContain("Connected as work@example.com");
  expect(render({ ...status, authorized: false })).not.toContain(
    "Connected as",
  );
});
