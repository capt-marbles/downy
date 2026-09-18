import { afterEach, expect, it, vi } from "vitest";
import { buildHeaderTransport } from "./mcp-reconnect";
afterEach(() => vi.unstubAllGlobals());
it("redacts split secrets and emits a complete SSE event without waiting for stream closure", async () => {
  let source: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
    ),
  );
  const transport = buildHeaderTransport("sse", {
    Authorization: "Bearer secret-value",
  });
  expect(JSON.stringify(transport)).not.toContain("secret-value");
  const response = await transport.fetch("https://example.com/mcp");
  const reader = response.body!.getReader();
  source!.enqueue(new TextEncoder().encode('data: {"error":"secret-'));
  source!.enqueue(new TextEncoder().encode('value"}\n\n'));
  const event = new TextDecoder().decode((await reader.read()).value);
  expect(event).toBe('data: {"error":"[REDACTED]"}\n\n');
  await reader.cancel();
});
it("scrubs a finite discovery response and discards obsolete content-length", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response('{"name":"secret-value"}', {
          headers: {
            "content-type": "application/json",
            "content-length": "23",
          },
        }),
    ),
  );
  const transport = buildHeaderTransport("streamable-http", {
    Authorization: "Bearer secret-value",
  });
  const response = await transport.fetch("https://example.com/mcp");
  expect(await response.text()).toBe('{"name":"[REDACTED]"}');
  expect(response.headers.has("content-length")).toBe(false);
});
it("redacts decoded Basic values if a vendor echoes them", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"error":"username:password"}')),
  );
  const transport = buildHeaderTransport("auto", {
    Authorization: `Basic ${btoa("username:password")}`,
  });
  expect(
    await (await transport.fetch("https://example.com/mcp")).text(),
  ).not.toContain("username:password");
});
