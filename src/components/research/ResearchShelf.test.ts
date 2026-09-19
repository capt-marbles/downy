import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import ResearchShelf from "./ResearchShelf";
import {
  fixedResearchSpec,
  type ResearchSnapshot,
} from "../../lib/research-view";

type CapturedLink = {
  children: ReactNode;
  to: string;
  params: { slug: string; _splat: string };
  state: (previous: object) => object;
};
const links = vi.hoisted(() => vi.fn<(props: CapturedLink) => void>());
vi.mock("@tanstack/react-router", () => ({
  Link: (props: CapturedLink) => {
    links(props);
    return createElement("a", null, props.children);
  },
}));

it("opens documents with a return destination to the saved research cards", () => {
  const records: ResearchSnapshot["records"] = [
    {
      id: "file0",
      path: "workspace/research/Report #1.md",
      title: "A report",
      excerpt: "Saved research",
      kind: "Report",
      size: 12,
      updatedAt: 1,
    },
  ];
  const snapshot: ResearchSnapshot = {
    version: 1,
    mode: "reports",
    generatedAt: 1,
    checkedAt: 1,
    omitted: 0,
    records,
    spec: fixedResearchSpec(records),
    composition: {
      state: "jev",
      reason: null,
      models: ["jev-test"],
      calls: 2,
      inputTokens: 12,
      elapsedMs: 10,
    },
  };
  renderToStaticMarkup(
    createElement(ResearchShelf, { slug: "buildroom", snapshot }),
  );
  expect(links).toHaveBeenCalled();
  const props = links.mock.calls[0][0];
  expect(props.to).toBe("/agent/$slug/workspace/$");
  expect(props.params).toEqual({
    slug: "buildroom",
    _splat: "workspace/research/Report%20%231.md",
  });
  expect(props.state({ preserved: true })).toEqual({
    preserved: true,
    back: { href: "/agent/buildroom/research", label: "research & reports" },
  });
});
