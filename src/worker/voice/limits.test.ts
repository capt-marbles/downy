import { expect, it } from "vitest";
import { voiceMaxMs } from "./limits";

it("reads the call cap from the deployment and clamps it", () => {
  expect(voiceMaxMs({ DOWNY_VOICE_MAX_MINUTES: "" })).toBe(15 * 60_000);
  expect(voiceMaxMs({ DOWNY_VOICE_MAX_MINUTES: "nope" })).toBe(15 * 60_000);
  expect(voiceMaxMs({ DOWNY_VOICE_MAX_MINUTES: "0" })).toBe(15 * 60_000);
  expect(voiceMaxMs({ DOWNY_VOICE_MAX_MINUTES: "45" })).toBe(45 * 60_000);
  expect(voiceMaxMs({ DOWNY_VOICE_MAX_MINUTES: "2" })).toBe(5 * 60_000);
  expect(voiceMaxMs({ DOWNY_VOICE_MAX_MINUTES: "600" })).toBe(120 * 60_000);
});
