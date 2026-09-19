import { computerStub } from "../cloud-computer/stub";

// Reached only after server.ts verifies Cloudflare Access. No raw proxy to the
// container: neither inference nor its credential bootstrap is a browser API.
export async function handleCloudComputerRequest(
  request: Request,
  env: Env,
  provider: "cloud-computer" | "boat-computer" = "cloud-computer",
): Promise<Response> {
  const path =
    new URL(request.url).pathname.replace(`/api/${provider}`, "") || "/status";
  const allowed =
    request.method === "GET"
      ? path === "/status"
      : request.method === "POST" &&
        [
          "/wake",
          "/login",
          "/restart",
          ...(provider === "boat-computer" ? ["/sleep"] : []),
        ].includes(path);
  if (!allowed) return Response.json({ error: "Not found" }, { status: 404 });
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin)
      return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const stub = computerStub(env, provider);
    const response = await stub.fetch(
      new Request(`https://computer.internal${path}`, {
        method: request.method,
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      {
        configured: false,
        state: "sleeping",
        authenticated: false,
        updatedAt: Date.now(),
        error: "Cloud computer has not been enabled for this deployment.",
        model: env.DOWNY_CODEX_MODEL,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
