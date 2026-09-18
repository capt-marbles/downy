import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import ToolPart from "./ToolParts";
vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
it("renders ordinary tool results without mistaking them for credential tickets", () => {
  const html = renderToStaticMarkup(
    createElement(ToolPart, {
      part: {
        type: "tool-read",
        state: "output-available",
        input: { path: "workspace/file.md" },
        output: { content: "Example" },
      },
      turnEnded: true,
    }),
  );
  expect(html).toContain("workspace/file.md");
  expect(html).not.toContain("credential-request");
  expect(html).not.toContain("Preparing secure");
});
it("renders a rejected-credential retry as an uncontrolled password card", () => {
  const html = renderToStaticMarkup(
    createElement(ToolPart, {
      part: {
        type: "tool-connect_mcp_server",
        state: "output-available",
        output: {
          credentialRequest: {
            ticketId: "ticket",
            expiresAt: Date.now() + 900000,
            fields: [
              { headerName: "Authorization", label: "Token", scheme: "bearer" },
            ],
          },
        },
      },
      turnEnded: true,
    }),
  );
  expect(html).toContain('data-kind="credential-request"');
  expect(html).toContain('type="password"');
  expect(html).toContain('autoComplete="off"');
  expect(html).not.toContain("value=");
});
