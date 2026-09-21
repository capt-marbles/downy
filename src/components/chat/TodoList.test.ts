import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import TodoList from "./TodoList";

function turn(id: string, output: unknown): UIMessage[] {
  return [
    { id: `${id}-user`, role: "user", parts: [{ type: "text", text: "go" }] },
    {
      id: `${id}-assistant`,
      role: "assistant",
      parts: [
        {
          type: "tool-todo_write",
          toolCallId: id,
          state: "output-available",
          input: {},
          output,
        },
      ],
    },
  ];
}

it("shows a plan only when the current turn wrote it and it was accepted", () => {
  const open = { todos: [{ content: "Count inbox", status: "in_progress" }] };
  const stale = [
    ...turn("old", open),
    { id: "new-user", role: "user", parts: [{ type: "text", text: "draft" }] },
    {
      id: "new-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "…" }],
    },
  ] as UIMessage[];
  expect(
    renderToStaticMarkup(createElement(TodoList, { messages: stale })),
  ).toBe("");
  expect(
    renderToStaticMarkup(
      createElement(TodoList, { messages: turn("now", open) }),
    ),
  ).toContain("Count inbox");
  const rejected = turn("bad", {
    error: "2 items are 'in_progress' at once.",
    todos: [
      { content: "a", status: "in_progress" },
      { content: "b", status: "in_progress" },
    ],
  });
  expect(
    renderToStaticMarkup(createElement(TodoList, { messages: rejected })),
  ).toBe("");
});
