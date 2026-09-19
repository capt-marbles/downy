import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import PilotChoices from "./PilotChoices";
import { fixedPilotSpec, type PilotChoice } from "../../lib/pilot-choices";
vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
const fixture: PilotChoice = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 1,
  createdAt: 0,
  expiresAt: Date.now() + 86400_000,
  selectedId: null,
  selectedAt: null,
  spec: fixedPilotSpec(),
  composition: { state: "jev", models: ["jev-test"], calls: 2, elapsedMs: 100 },
};
function render(choice: PilotChoice) {
  const client = new QueryClient();
  client.setQueryData(["pilot-choice", "test", choice.id], choice);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(PilotChoices, { ticketId: choice.id }),
    ),
  );
  client.clear();
  return html;
}
it("renders three choices from the saved spec and identifies who arranged them", () => {
  const html = render(fixture);
  expect(html.match(/data-pilot-card=/g)).toHaveLength(3);
  expect(html.match(/Choose this pilot/g)).toHaveLength(3);
  expect(html).toContain("Arranged by Jev on Cloudflare");
  expect(html).toContain("starting the work is a separate step");
});
it("restores a selected card with every selection button disabled", () => {
  const html = render({ ...fixture, selectedId: "recovery", selectedAt: 20 });
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  expect(html).toContain("Selected");
  expect(html).toContain("Preference saved. No task has started.");
});
it("keeps expired options readable while preventing a new selection", () => {
  const html = render({ ...fixture, expiresAt: 1 });
  expect(html.match(/data-pilot-card=/g)).toHaveLength(3);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  expect(html).toContain("These options expired");
});
