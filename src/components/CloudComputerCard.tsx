import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ComputerStatusSchema,
  LoginSchema,
} from "../worker/cloud-computer/protocol";
import { useAiProvider } from "../lib/preferences";
import StatusDot from "./ui/StatusDot";

const LABELS = {
  sleeping: "Cloud computer sleeping",
  starting: "Starting cloud computer…",
  ready: "Cloud computer ready",
  running: "Working on cloud computer…",
  interrupted: "Cloud computer interrupted",
  error: "Cloud computer needs attention",
};

export default function CloudComputerCard({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [provider] = useAiProvider();
  const [login, setLogin] = useState<{
    verificationUrl: string;
    userCode: string;
  } | null>(null);
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["cloud-computer"],
    enabled: !compact || provider === "cloud-computer",
    refetchInterval: 2_000,
    queryFn: async () => {
      const response = await fetch("/api/cloud-computer");
      if (!response.ok)
        throw new Error("Could not read cloud computer status.");
      return ComputerStatusSchema.parse(await response.json());
    },
  });
  const action = useMutation({
    mutationFn: async (path: "wake" | "login" | "restart") => {
      const response = await fetch(`/api/cloud-computer/${path}`, {
        method: "POST",
      });
      if (!response.ok)
        throw new Error(
          "Cloud computer could not complete that request. Try again shortly.",
        );
      if (path === "login") setLogin(LoginSchema.parse(await response.json()));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["cloud-computer"] }),
  });
  if (compact && provider !== "cloud-computer") return null;
  return (
    <section
      className={
        compact
          ? "rounded-lg border border-base-300 px-3 py-2 text-xs"
          : "card border border-base-300 bg-base-100 p-4"
      }
      aria-label="Cloud computer"
    >
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <StatusDot
          tone={
            data?.state === "error"
              ? "warning"
              : data?.state === "ready"
                ? "success"
                : "neutral"
          }
          pulse={data?.state === "starting" || data?.state === "running"}
        />
        <strong>
          {data
            ? data.configured
              ? LABELS[data.state]
              : "Cloud computer not configured"
            : "Checking cloud computer…"}
        </strong>
      </div>
      <p className="mt-1 text-xs text-base-content/60">
        Cloudflare · Codex{data ? ` · ${data.model}` : ""} · ChatGPT
        subscription
      </p>
      {(error || action.error || data?.error) && (
        <p className="mt-2 text-sm text-warning" role="alert">
          {error?.message ?? action.error?.message ?? data?.error}
        </p>
      )}
      {data?.configured && !compact && (
        <>
          <p className="my-3 text-sm">
            {data.authenticated
              ? "ChatGPT connected. Your login is preserved across computer restarts."
              : "Connect your ChatGPT account to use its Codex allowance. No API fallback."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm"
              disabled={action.isPending || data.state === "running"}
              onClick={() => action.mutate("wake")}
            >
              Wake computer
            </button>
            {!data.authenticated && (
              <button
                className="btn btn-primary btn-sm"
                disabled={action.isPending}
                onClick={() => action.mutate("login")}
              >
                Connect ChatGPT
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              disabled={action.isPending || data.state === "running"}
              onClick={() => action.mutate("restart")}
            >
              Restart computer
            </button>
          </div>
          {login && !data.authenticated && (
            <div className="mt-3 rounded-lg border border-base-300 p-3">
              <p className="text-sm">
                Enter this one-time code on OpenAI’s sign-in page:
              </p>
              <code className="my-2 block select-all text-lg">
                {login.userCode}
              </code>
              <a
                className="btn btn-primary btn-sm"
                href={login.verificationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Sign in with ChatGPT
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}
