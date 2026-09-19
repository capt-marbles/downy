import { StepInputSchema } from "./protocol";
/* eslint-disable typescript/no-unsafe-type-assertion, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- bounded fake Env and mock request inspection */
import { describe, expect, it, vi } from "vitest";
import { cloudComputerModel } from "./model";
import { handleCloudComputerRequest } from "../handlers/cloud-computer";
function environment(fetch: ReturnType<typeof vi.fn>) {
  return {
    DOWNY_CODEX_MODEL: "gpt-5.5",
    CloudComputer: { idFromName: () => "personal", get: () => ({ fetch }) },
  } as unknown as Env;
}
describe("cloud computer boundary", () => {
  it("routes the Boat pilot only to its own DO and preserves Downy's tool handoff", async () => {
    const cloudFetch = vi.fn();
    const boatFetch = vi.fn().mockResolvedValue(
      Response.json({
        text: "",
        toolCalls: [
          {
            id: "call1",
            name: "write",
            arguments: '{"path":"workspace/pilot.md","content":"Report"}',
          },
        ],
      }),
    );
    const env = {
      ...environment(cloudFetch),
      BoatComputer: {
        idFromName: () => "personal",
        get: () => ({ fetch: boatFetch }),
      },
    } as unknown as Env;
    const model = cloudComputerModel(env, "boat-computer");
    const result = await model.doGenerate({
      prompt: [
        { role: "user", content: [{ type: "text", text: "Save report" }] },
      ],
      tools: [
        { type: "function", name: "write", inputSchema: { type: "object" } },
      ],
    });
    expect(model.provider).toBe("boat-computer");
    expect(cloudFetch).not.toHaveBeenCalled();
    expect(result.finishReason.unified).toBe("tool-calls");
    expect(result.content[0].type).toBe("tool-call");
    const request: Request = boatFetch.mock.calls[0][0];
    expect(
      StepInputSchema.parse(await request.json()).tools.map(
        (tool) => tool.name,
      ),
    ).toEqual(["write"]);
  });
  it("keeps Boat inference, initialization and cross-origin lifecycle requests off the browser API", async () => {
    const fetch = vi.fn();
    const env = {
      ...environment(vi.fn()),
      BoatComputer: { idFromName: () => "personal", get: () => ({ fetch }) },
    } as unknown as Env;
    for (const path of ["step", "initialize", "account"]) {
      const response = await handleCloudComputerRequest(
        new Request(`https://downy.test/api/boat-computer/${path}`, {
          method: "POST",
          headers: { origin: "https://downy.test" },
        }),
        env,
        "boat-computer",
      );
      expect(response.status).toBe(404);
    }
    const response = await handleCloudComputerRequest(
      new Request("https://downy.test/api/boat-computer/sleep", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
      env,
      "boat-computer",
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("yields tool intent to Downy and forwards only the active tool surface", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        text: "",
        toolCalls: [
          {
            id: "call1",
            name: "read",
            arguments: '{"path":"workspace/report.md"}',
          },
        ],
      }),
    );
    const result = await cloudComputerModel(environment(fetch)).doGenerate({
      prompt: [
        { role: "user", content: [{ type: "text", text: "Read my report" }] },
      ],
      tools: [
        { type: "function", name: "read", inputSchema: { type: "object" } },
      ],
    });
    const request: Request = fetch.mock.calls[0][0];
    expect(
      StepInputSchema.parse(await request.json()).tools.map((t) => t.name),
    ).toEqual(["read"]);
    expect(result.finishReason.unified).toBe("tool-calls");
    expect(result.content[0].type).toBe("tool-call");
    expect(result.usage.inputTokens.total).toBeUndefined();
  });
  it("fails explicitly when signed out and never calls a fallback model", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    await expect(
      cloudComputerModel(environment(fetch)).doGenerate({ prompt: [] }),
    ).rejects.toThrow("Reconnect ChatGPT");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not expose credential initialization or inference as browser endpoints", async () => {
    const fetch = vi.fn();
    const response = await handleCloudComputerRequest(
      new Request("https://downy.test/api/cloud-computer/initialize", {
        method: "POST",
        body: "{}",
        headers: { origin: "https://downy.test" },
      }),
      environment(fetch),
    );
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects cross-origin login and restart requests", async () => {
    const fetch = vi.fn();
    const response = await handleCloudComputerRequest(
      new Request("https://downy.test/api/cloud-computer/login", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
      environment(fetch),
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
