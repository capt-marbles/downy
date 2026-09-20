import ComposioConnectCard from "./ComposioConnectCard";
import GmailConnectCard from "./GmailConnectCard";
import { agentFetch } from "../../lib/agent-request";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useCurrentAgentSlug } from "../../lib/agents";
import CredentialCard from "./CredentialCard";
import type { ToolPart } from "./tool-part-types";
import { CredentialTicketSchema } from "../../worker/credentials/types";
const Candidates = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      toolkit: z.string().optional(),
      path: z.string(),
      confidence: z.enum(["confirmed", "guess"]),
      docsUrl: z.string().optional(),
    }),
  ),
});
const Setup = z.union([
  z.object({
    kind: z.literal("oauth"),
    setupId: z.string(),
    redirectUrl: z.string().url(),
  }),
  CredentialTicketSchema.extend({
    kind: z.literal("credential-request"),
    setupId: z.string(),
  }),
]);
export default function ToolSetupCard({ part }: { part: ToolPart }) {
  const slug = useCurrentAgentSlug();
  const parsed = Candidates.safeParse(part.output);
  const [toolkit, setToolkit] = useState("");
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [setup, setSetup] = useState<z.infer<typeof Setup> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tools = useQuery({
    queryKey: ["composio-tools", toolkit, slug],
    enabled: !!toolkit,
    queryFn: async () => {
      const response = await agentFetch(
        slug,
        `/api/composio?toolkit=${encodeURIComponent(toolkit)}`,
      );
      return z
        .object({
          items: z.array(
            z.object({ slug: z.string(), name: z.string().optional() }),
          ),
        })
        .parse(await response.json()).items;
    },
  });
  const status = useQuery({
    queryKey: ["composio-setup", setup?.setupId, slug],
    enabled: !!setup,
    refetchInterval: (query) =>
      ["ready", "failed"].includes(query.state.data?.state ?? "")
        ? false
        : 3000,
    queryFn: async () => {
      const response = await agentFetch(
        slug,
        `/api/composio?setupId=${encodeURIComponent(setup!.setupId)}`,
      );
      return z
        .object({
          state: z.string(),
          toolNames: z.array(z.string()),
          error: z.string().nullable(),
        })
        .parse(await response.json());
    },
  });
  if (!parsed.success) return <p className="text-xs">Finding setup options…</p>;
  if (
    parsed.data.candidates.some(
      (candidate) => candidate.path === "composio-connect",
    )
  )
    return <ComposioConnectCard />;
  if (
    parsed.data.candidates.length === 1 &&
    parsed.data.candidates[0]?.toolkit === "gmail"
  )
    return <GmailConnectCard />;
  return (
    <section className="my-3 rounded-lg border border-base-300 bg-base-100 p-4">
      <h3 className="font-semibold">Connect a service</h3>
      {parsed.data.candidates.map((candidate) => (
        <div key={candidate.name} className="my-2 text-sm">
          <strong>{candidate.name}</strong> · {candidate.confidence}
          {candidate.toolkit ? (
            <button
              className="btn btn-xs ml-2"
              onClick={() => {
                setToolkit(candidate.toolkit!);
                setAllowedTools([]);
                setSetup(null);
              }}
            >
              Choose tools
            </button>
          ) : (
            candidate.docsUrl && (
              <a
                href={candidate.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="link ml-2"
              >
                Vendor documentation
              </a>
            )
          )}
        </div>
      ))}
      {toolkit && !setup && (
        <>
          <p className="my-2 text-xs">Select up to 12 tools to attach.</p>
          <div className="max-h-52 overflow-auto">
            {tools.data?.map((tool) => (
              <label
                key={tool.slug}
                className="flex items-center gap-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={allowedTools.includes(tool.slug)}
                  disabled={
                    !allowedTools.includes(tool.slug) &&
                    allowedTools.length >= 12
                  }
                  onChange={(e) =>
                    setAllowedTools(
                      e.target.checked
                        ? [...allowedTools, tool.slug]
                        : allowedTools.filter(
                            (toolSlug) => toolSlug !== tool.slug,
                          ),
                    )
                  }
                />
                {tool.name ?? tool.slug}
              </label>
            ))}
          </div>
          <button
            className="btn btn-primary btn-sm mt-3"
            disabled={busy || !allowedTools.length}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const response = await agentFetch(slug, "/api/composio", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({ toolkit, allowedTools }),
                });
                if (!response.ok) throw new Error("Setup failed");
                setSetup(Setup.parse(await response.json()));
              } catch {
                setError("Setup failed; check the toolkit configuration");
              } finally {
                setBusy(false);
              }
            }}
          >
            Set up selected tools
          </button>
        </>
      )}
      {setup?.kind === "oauth" && (
        <a
          className="btn btn-primary btn-sm mt-3"
          href={setup.redirectUrl}
          target="_blank"
          rel="noreferrer"
        >
          Authorize {toolkit}
        </a>
      )}
      {setup?.kind === "credential-request" && (
        <CredentialCard part={{ type: "credential-request", output: setup }} />
      )}
      {status.data?.state === "ready" && (
        <p className="mt-3 text-sm">
          Connected: {status.data.toolNames.join(", ")}
        </p>
      )}
      {(error || tools.error || status.error || status.data?.error) && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error ?? status.data?.error ?? "Could not load setup status"}
        </p>
      )}
    </section>
  );
}
