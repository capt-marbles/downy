/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deliberately partial Workspace fixture; the builders only read files, stat and glob. */
import { expect, it } from "vitest";
import {
  buildSystemPrompt,
  buildVoiceSystemPrompt,
} from "./build-system-prompt";

// Minimal workspace: identity files plus one skill, no bootstrap.
function workspace(files: Record<string, string>) {
  return {
    async readFile(path: string) {
      return files[path] ?? null;
    },
    async stat() {
      return null;
    },
    async glob() {
      return [];
    },
  } as never;
}

const files = {
  "identity/IDENTITY.md": "Name: Downy",
  "identity/SOUL.md": "Calm and precise.",
  "identity/MEMORY.md": "Talked to Studio A yesterday.",
};

it("puts memory, plan and date after the stable identity, skills and connections", async () => {
  const prompt = await buildSystemPrompt(workspace(files), "Andrew, GTM.", [], {
    todos: [{ content: "Call Studio A", status: "in_progress" }],
    updatedAt: 1,
  });
  const head = prompt.system.slice(0, prompt.stablePrefixChars);
  const tail = prompt.system.slice(prompt.stablePrefixChars);
  expect(head).toContain("## IDENTITY.md");
  expect(head).toContain("## Connections");
  expect(head).not.toContain("## MEMORY.md");
  expect(head).not.toContain("## Environment");
  expect(tail).toContain("## USER.md");
  expect(tail).toContain("## MEMORY.md");
  expect(tail).toContain("## Active plan");
  expect(tail.trimEnd()).toMatch(/## Environment\nToday: \d{4}-\d{2}-\d{2}$/);
  // Editing memory must not move the stable prefix.
  const edited = await buildSystemPrompt(
    workspace({ ...files, "identity/MEMORY.md": "Talked to Studio B today." }),
    "Andrew, GTM.",
    [],
    null,
  );
  expect(edited.system.slice(0, edited.stablePrefixChars)).toBe(head);
});

it("orders the voice prompt the same way", async () => {
  const prompt = await buildVoiceSystemPrompt(
    workspace(files),
    "Andrew.",
    null,
  );
  const head = prompt.system.slice(0, prompt.stablePrefixChars);
  expect(head.startsWith("You are on a live voice call")).toBe(true);
  expect(head).toContain("## Connections");
  expect(head).not.toContain("## MEMORY.md");
  expect(prompt.system.slice(prompt.stablePrefixChars)).toContain(
    "## MEMORY.md",
  );
});
