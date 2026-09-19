/** All browser requests for agent-owned resources use this transport. Keep the
 * scope in the URL so custom-header stripping cannot silently select an agent.
 * User-level APIs continue to use fetch directly. */
export function agentFetch(
  slug: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!slug) throw new Error("An agent must be selected");
  // This helper must never forward a credential body to an external origin.
  const base = "https://downy.invalid";
  const url = new URL(path, base);
  if (url.origin !== base || !url.pathname.startsWith("/api/")) {
    throw new Error("Agent requests must use a local API URL");
  }
  url.searchParams.set("agentSlug", slug);
  const headers = new Headers(init?.headers);
  headers.set("X-Agent-Slug", slug);
  return fetch(`${url.pathname}${url.search}`, {
    ...init,
    cache: "no-store",
    // Plain objects also survive fetch wrappers that spread init.headers.
    headers: Object.fromEntries(headers),
  });
}
