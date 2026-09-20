import { z } from "zod";
import { composio } from "./client";

// These endpoints are documented by their vendors; unknown names go to docs
// search, never to guessed hostnames or credential prompts.
const DIRECT = [
  {
    name: "Cloudflare docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    docsUrl: "https://github.com/github/github-mcp-server",
  },
];
export async function findToolSetup(env: Cloudflare.Env, query: string) {
  if (/^(connect )?composio$/i.test(query.trim()))
    return {
      candidates: [
        {
          name: "Composio",
          path: "composio-connect" as const,
          confidence: "confirmed" as const,
        },
      ],
      warnings: [],
    };
  if (/^(gmail|google mail|connect gmail)$/i.test(query.trim()))
    return {
      candidates: [
        {
          name: "Gmail",
          toolkit: "gmail",
          path: "composio" as const,
          confidence: "confirmed" as const,
        },
      ],
      warnings: [],
    };
  const warnings: string[] = [];
  try {
    const list = await composio(
      env.COMPOSIO_API_KEY,
      `/toolkits?search=${encodeURIComponent(query)}&limit=20`,
    );
    const toolkits = z
      .array(z.object({ slug: z.string(), name: z.string() }))
      .parse(list.items);
    if (toolkits.length)
      return {
        candidates: toolkits.map((t) => ({
          name: t.name,
          toolkit: t.slug,
          path: "composio" as const,
          confidence: "confirmed" as const,
        })),
        warnings,
      };
  } catch {
    warnings.push("Composio discovery unavailable");
  }
  const direct = DIRECT.filter((entry) =>
    entry.name.toLowerCase().includes(query.toLowerCase()),
  );
  if (direct.length)
    return {
      candidates: direct.map((entry) => ({
        ...entry,
        path: "direct-mcp" as const,
        confidence: "confirmed" as const,
      })),
      warnings,
    };
  try {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": env.EXA_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `${query} official MCP server documentation`,
        numResults: 5,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Search failed");
    const result = z
      .object({
        results: z.array(
          z.object({ title: z.string().nullable(), url: z.string().url() }),
        ),
      })
      .parse(await response.json());
    return {
      candidates: result.results.map((entry) => ({
        name: entry.title ?? query,
        docsUrl: entry.url,
        path: "vendor-docs" as const,
        confidence: "guess" as const,
      })),
      warnings,
    };
  } catch {
    return {
      candidates: [],
      warnings: [...warnings, "Vendor documentation search unavailable"],
    };
  }
}
