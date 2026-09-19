import { expect, it, vi } from "vitest";
import {
  fixedPilotSpec,
  selectedPilot,
  type PilotChoice,
} from "../../lib/pilot-choices";
import { handlePilotVoiceRequest } from "./voice";
const question =
  "You: Hi, show me the CUA pilot options\nDowny: Here are three options.";
function fixture() {
  let choice: PilotChoice = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    createdAt: 0,
    expiresAt: Date.now() + 86400_000,
    selectedId: null,
    selectedAt: null,
    spec: fixedPilotSpec(),
    composition: {
      state: "jev",
      models: ["jev-test"],
      calls: 2,
      elapsedMs: 100,
    },
  };
  const backend = {
    create: vi.fn(async () => choice),
    latest: vi.fn(async () => choice),
    select: vi.fn(
      async (_id: string, option: Parameters<typeof selectedPilot>[1]) => {
        try {
          choice = selectedPilot(choice, option, Date.now());
          return { choice, error: null };
        } catch {
          return { choice, error: "A pilot has already been selected." };
        }
      },
    ),
  };
  return backend;
}
it("routes the reported voice conversation through a persisted preference and URL instructions", async () => {
  const backend = fixture();
  expect(await handlePilotVoiceRequest(question, backend)).toContain("in chat");
  const transcript = `${question}\nYou: I think comparing three sources about AI tools for game development`;
  const answer = await handlePilotVoiceRequest(transcript, backend);
  expect(backend.select).toHaveBeenCalledWith(
    "11111111-1111-4111-8111-111111111111",
    "source-comparison",
  );
  expect((await backend.latest()).selectedId).toBe("source-comparison");
  expect(answer).toContain("No research has started");
  expect(answer).toContain("three source URL fields");
  expect(answer).toContain("Save sources");
  expect(await handlePilotVoiceRequest(transcript, backend)).toContain(
    "is saved",
  );
});
it.each([
  ["I choose reading one public page", "single-page"],
  ["The second one", "source-comparison"],
  ["Let's go with recovery from a broken link", "recovery"],
])("maps explicit selection %s to a bounded option", async (reply, option) => {
  const backend = fixture();
  await handlePilotVoiceRequest(`${question}\nYou: ${reply}`, backend);
  expect((await backend.latest()).selectedId).toBe(option);
});
it.each([
  "Maybe compare three sources",
  "I don't want the second one",
  "I think comparing three sources or reading one public page",
  "Why would I choose the second one?",
  "Okay, how do I give you those",
  "Great, thanks",
  "Start the comparison now",
])("does not save ambiguous or unrelated latest speech: %s", async (reply) => {
  const backend = fixture();
  expect(
    await handlePilotVoiceRequest(`${question}\nYou: ${reply}`, backend),
  ).toBeNull();
  expect(backend.select).not.toHaveBeenCalled();
});
it("cannot select without a current ticket or claim a conflicting choice saved", async () => {
  const backend = fixture();
  await handlePilotVoiceRequest(`${question}\nYou: The second one`, backend);
  expect(
    await handlePilotVoiceRequest(`${question}\nYou: The first one`, backend),
  ).toContain("not saved");
  expect((await backend.latest()).selectedId).toBe("source-comparison");
  const missing = { ...backend, latest: async () => null };
  backend.select.mockClear();
  expect(
    await handlePilotVoiceRequest(`${question}\nYou: The second one`, missing),
  ).toContain("no current");
  expect(backend.select).not.toHaveBeenCalled();
});
