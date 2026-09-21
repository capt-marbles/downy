import { expect, it, vi } from "vitest";
import { connectWithTriage, type McpAttempt } from "./mcp-triage";
const failure: {
  id: string;
  state: string;
  error: string | null;
  toolNames: string[];
  authUrl?: string | null;
} = {
  id: "server",
  state: "failed",
  error: "Connection failed",
  toolNames: [],
};
const response = (classification: string, confidence = 0.9) => ({
  model: "jev-1.13.0",
  answers: {
    failure_class: {
      type: "choice",
      choice: classification,
      confidence,
      probabilities: { [classification]: 1 },
    },
    retry_worthwhile: { type: "noul", noul: 0.9 },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
});
function fixture(classification: string, confidence = 0.9) {
  const connect = vi.fn(async (_attempt: McpAttempt) => failure);
  const requestCredential = vi.fn(async () => ({
    ticketId: "ticket",
    expiresAt: Date.now() + 900000,
    fields: [{ headerName: "Authorization", label: "Token", scheme: "bearer" }],
  }));
  const run = vi.fn(async () => response(classification, confidence));
  return {
    initial: {
      url: "https://example.com/wrong",
      transport: "auto" as const,
      oauth: false,
    },
    headerNames: ["Authorization"],
    secretValues: ["Bearer SECRET", "SECRET"],
    confidenceFloor: 0.6,
    connect,
    run,
    requestCredential,
    probe: async () => ({
      status: 400,
      statusText: "Error",
      contentType: "text/plain",
      bodyPreview: "Rejected SECRET",
    }),
    sleep: async () => {},
  };
}
it.each(["credentials_rejected", "not_an_mcp_endpoint", "unknown"])(
  "%s stops retries",
  async (classification) => {
    const deps = fixture(classification);
    await connectWithTriage(deps);
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(deps.requestCredential).toHaveBeenCalledTimes(
      classification === "credentials_rejected" ? 1 : 0,
    );
  },
);
it("wrong transport follows auto -> streamable-http -> sse", async () => {
  const deps = fixture("wrong_transport");
  await connectWithTriage(deps);
  expect(deps.connect.mock.calls.map(([attempt]) => attempt.transport)).toEqual(
    ["auto", "streamable-http", "sse"],
  );
});
it("URL candidates are ordered and stop at four total attempts", async () => {
  const deps = fixture("wrong_url_shape");
  const result = await connectWithTriage(deps);
  expect(deps.connect.mock.calls.map(([attempt]) => attempt.url)).toEqual([
    "https://example.com/wrong",
    "https://example.com/wrong/",
    "https://example.com/mcp",
    "https://example.com/sse",
  ]);
  expect(result.steps).toHaveLength(4);
});
it("needs OAuth stops the header path", async () => {
  const deps = fixture("needs_oauth");
  await connectWithTriage(deps);
  expect(deps.connect.mock.calls.map(([attempt]) => attempt.oauth)).toEqual([
    false,
    true,
  ]);
});
it.each(["server_down", "rate_limited"])(
  "%s retries only once after backoff",
  async (classification) => {
    const deps = fixture(classification);
    const sleep = vi.fn(async () => {});
    await connectWithTriage({ ...deps, sleep });
    expect(deps.connect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  },
);
it("low confidence and a thrown Jev call return manual guidance", async () => {
  const low = fixture("wrong_transport", 0.5);
  expect((await connectWithTriage(low)).guidance).toContain("vendor docs");
  expect(low.connect).toHaveBeenCalledTimes(1);
  const down = fixture("wrong_transport");
  expect(
    (
      await connectWithTriage({
        ...down,
        run: async () => {
          throw new Error("unavailable");
        },
      })
    ).guidance,
  ).toBeTruthy();
  expect(down.connect).toHaveBeenCalledTimes(1);
});
it("never puts a header value in Jev state, even if the probe echoes it", async () => {
  const deps = fixture("unknown");
  const requests: unknown[] = [];
  await connectWithTriage({
    ...deps,
    run: async (request) => {
      requests.push(request);
      return response("unknown");
    },
  });
  expect(JSON.stringify(requests)).not.toContain("SECRET");
  expect(JSON.stringify(requests)).toContain("Authorization");
});
it("honors the wall-clock budget and times out a hanging attempt", async () => {
  let clock = 0;
  const deps = fixture("wrong_transport");
  await connectWithTriage({
    ...deps,
    now: () => clock,
    connect: async (attempt) => {
      clock += 20_001;
      return deps.connect(attempt);
    },
  });
  expect(deps.connect).toHaveBeenCalledTimes(1);
  vi.useFakeTimers();
  const pending = connectWithTriage({
    ...fixture("unknown"),
    connect: () => new Promise(() => {}),
  });
  await vi.advanceTimersByTimeAsync(20_001);
  expect((await pending).state).toBe("failed");
  vi.useRealTimers();
});

it("passes an OAuth authorization link through an authenticating result untouched", async () => {
  const deps = fixture("unknown");
  deps.initial.oauth = true;
  deps.connect.mockResolvedValueOnce({
    id: "server",
    state: "authenticating",
    error: null,
    toolNames: [],
    authUrl: "https://treg.to/oauth/authorize?client_id=abc&state=SECRET",
  });
  const result = await connectWithTriage(deps);
  expect(result.state).toBe("authenticating");
  expect(result.authUrl).toBe(
    "https://treg.to/oauth/authorize?client_id=abc&state=SECRET",
  );
  expect(deps.connect).toHaveBeenCalledTimes(1);
  expect(deps.requestCredential).not.toHaveBeenCalled();
});
