import { getAgentStub, slugFromRequest } from "../lib/get-agent";
import { resolveCredentialRequest } from "../credentials/requests";
export async function handleCredentialsRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  try {
    const slug = slugFromRequest(request);
    if (new URL(request.url).pathname === "/api/credentials/migrate") {
      const agent = await getAgentStub(env, slug);
      return Response.json(await agent.migrateMcpCredentials());
    }
    const ticketId = new URL(request.url).pathname.split("/")[3];
    if (
      !ticketId ||
      Number(request.headers.get("content-length") ?? 0) > 90_000
    )
      return Response.json({ error: "Invalid submission" }, { status: 400 });
    const body = await request.text();
    if (body.length > 90_000)
      return Response.json({ error: "Invalid submission" }, { status: 413 });
    const agent = await getAgentStub(env, slug);
    const result = await resolveCredentialRequest(
      env.DB,
      ticketId,
      slug,
      JSON.parse(body) as unknown,
      (target, headers) => agent.connectCredential(target, headers),
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    // Deliberately no exception logging: request values never enter logs.
    return Response.json(
      { state: "failed", toolNames: [], error: "Credential submission failed" },
      { status: 400 },
    );
  }
}
