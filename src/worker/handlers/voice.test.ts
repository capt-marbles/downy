/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- only the handler's actual bindings are mocked */
import { beforeEach, expect, it, vi } from "vitest";
import { handleVoiceRequest } from "./voice";
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  end: vi.fn(),
  heartbeat: vi.fn(),
  active: vi.fn(),
}));
vi.mock("../lib/active-agent", () => ({ getActiveAgentStub: mocks.active }));
vi.mock("../lib/get-agent", () => ({
  slugFromRequest: (request: Request) =>
    request.headers.get("X-Agent-Slug") ?? "default",
  AgentSlugError: class extends Error {},
}));
const getByName = vi.fn(() => mocks);
const env = {
  DOWNY_VOICE_ENABLED: "true",
  OPENAI_API_KEY: "server-secret",
  VoiceCall: { getByName },
} as unknown as Cloudflare.Env;
const id = crypto.randomUUID();
const request = (body: object, origin = "https://downy.test") =>
  new Request("https://downy.test/api/voice", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Agent-Slug": "research",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue({});
});

it("routes an authenticated agent to its own coordinator without exposing credentials", async () => {
  mocks.start.mockResolvedValue({ callId: id, state: "active", sdp: "answer" });
  const response = await handleVoiceRequest(
    request({ command: "start", callId: id, sdp: "offer" }),
    env,
  );
  expect(getByName).toHaveBeenCalledWith("research");
  expect(mocks.start).toHaveBeenCalledWith("research", id, "offer");
  expect(await response.text()).not.toContain("server-secret");
});

it("rejects cross-origin posts and oversized bodies before starting a session", async () => {
  expect(
    (
      await handleVoiceRequest(
        request(
          { command: "start", callId: id, sdp: "offer" },
          "https://evil.test",
        ),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleVoiceRequest(
        request({ command: "start", callId: id, sdp: "x".repeat(71_000) }),
        env,
      )
    ).status,
  ).toBe(413);
  expect(mocks.start).not.toHaveBeenCalled();
});

it("never echoes internal errors or permits an unknown call to be ended", async () => {
  mocks.end.mockResolvedValue(null);
  expect(
    (await handleVoiceRequest(request({ command: "end", callId: id }), env))
      .status,
  ).toBe(404);
  mocks.start.mockRejectedValue(new Error("server-secret private SDP"));
  const response = await handleVoiceRequest(
    request({ command: "start", callId: id, sdp: "offer" }),
    env,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/server-secret|private SDP/);
});
