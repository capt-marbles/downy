import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import StagedActionCard from "./StagedActionCard";
import { newStagedAction, type StagedAction } from "../../lib/staged-actions";
vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
const base = newStagedAction(
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "voice",
  {
    kind: "gmail_draft",
    gmailDraft: {
      recipientEmail: "lead@example.com",
      subject: "Following up",
      body: "Hi there,\nfollowing up.",
    },
  },
  Date.now(),
);
function render(action: StagedAction) {
  const client = new QueryClient();
  client.setQueryData(["staged-action", "test", action.id], action);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(StagedActionCard, { stagedActionId: action.id }),
    ),
  );
  client.clear();
  return html;
}

it("shows the exact proposal with live confirm and cancel buttons", () => {
  const html = render(base);
  expect(html).toContain("lead@example.com");
  expect(html).toContain("Following up");
  expect(html).toContain("from your call");
  expect(html).toContain("Confirm and run");
  expect(html).not.toContain('disabled=""');
  expect(html).toContain("Saying yes in chat or on a call does not");
});

it("disables both buttons once the proposal is settled, expired or cancelled", () => {
  const done: StagedAction = {
    ...base,
    state: "succeeded",
    result: {
      receipt: "Draft created in Gmail.",
      url: "https://mail.google.com/mail/u/0/#drafts",
    },
  };
  const html = render(done);
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).toContain("Draft created in Gmail.");
  expect(html).toContain('href="https://mail.google.com/mail/u/0/#drafts"');
  expect(render({ ...base, expiresAt: Date.now() - 1 })).toContain(
    "This proposal expired",
  );
  expect(
    render({ ...base, state: "unknown", error: "Check Drafts." }),
  ).toContain("Outcome unknown");
  expect(
    render({ ...base, state: "cancelled" }).match(/disabled=""/g),
  ).toHaveLength(2);
});
