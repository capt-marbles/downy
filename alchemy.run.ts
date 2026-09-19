/// <reference types="@cloudflare/workers-types/experimental" />

import alchemy from "alchemy";
import {
  Ai,
  D1Database,
  DurableObjectNamespace,
  R2Bucket,
  SecretRef,
  TanStackStart,
} from "alchemy/cloudflare";

import type { ChildAgent as ChildAgentClass } from "./src/worker/agent/ChildAgent.ts";
import type { DownyAgent as DownyAgentClass } from "./src/worker/agent/DownyAgent.ts";
import type { VoiceCall as VoiceCallClass } from "./src/worker/voice/VoiceCall.ts";

const app = await alchemy("downy", {
  password: process.env.ALCHEMY_PASSWORD,
});

// `adopt: true` makes Alchemy take over the pre-existing `downy` worker,
// `downy` D1 database, and `downy-workspace` R2 bucket on first deploy
// instead of failing with "already exists". Subsequent deploys are
// idempotent updates.
const db = await D1Database("DB_BUILDROOM_20260525", {
  name: "downy-buildroom-20260525",
  adopt: true,
  migrationsDir: "./migrations",
});

const workspaceBucket = await R2Bucket("WORKSPACE_BUCKET_BUILDROOM_20260525", {
  name: "downy-buildroom-workspace-20260525",
  adopt: true,
});

const downyAgent = DurableObjectNamespace<DownyAgentClass>("DownyAgent", {
  className: "DownyAgent",
  sqlite: true,
});

const childAgent = DurableObjectNamespace<ChildAgentClass>("ChildAgent", {
  className: "ChildAgent",
  sqlite: true,
});

const voiceCall = DurableObjectNamespace<VoiceCallClass>("VoiceCall", {
  className: "VoiceCall",
  sqlite: true,
});

// Optional: only present when the user has set up the ChatGPT subscription
// path (see docs/pi-proxy-setup.md). The VPC service itself is provisioned
// out-of-band by `wrangler vpc service create`; we only reference it here.
// Built inline instead of via `VpcServiceRef` because alchemy@0.93.6's
// formatter crashes on IP-based services (resolver_network is null).
const piRelayVpc = process.env.PI_RELAY_VPC_SERVICE_ID
  ? {
      type: "vpc_service" as const,
      name: process.env.PI_RELAY_VPC_SERVICE_NAME ?? "pi-relay",
      serviceId: process.env.PI_RELAY_VPC_SERVICE_ID,
      createdAt: 0,
      updatedAt: 0,
      host: {
        ipv4: process.env.PI_RELAY_VPC_HOST ?? "127.0.0.1",
        network: {
          // Only used to satisfy Alchemy's VpcService shape for an existing
          // service reference; worker metadata uses name + serviceId.
          tunnelId: process.env.PI_RELAY_VPC_TUNNEL_ID ?? "",
        },
      },
    }
  : undefined;

export const worker = await TanStackStart("downy", {
  name: "downy",
  adopt: true,
  compatibilityDate: "2025-09-02",
  compatibilityFlags: ["nodejs_compat"],
  crons: ["*/5 * * * *"],
  bindings: {
    DOWNY_VOICE_ENABLED: process.env.DOWNY_VOICE_ENABLED ?? "false",
    // Provision this secret out of band; never accept an API key in chat.
    ...(process.env.DOWNY_VOICE_ENABLED === "true"
      ? { OPENAI_API_KEY: await SecretRef({ name: "DOWNY_OPENAI_API_KEY" }) }
      : {}),
    VoiceCall: voiceCall,
    MCP_TRIAGE_CONFIDENCE_FLOOR:
      process.env.MCP_TRIAGE_CONFIDENCE_FLOOR ?? "0.6",
    JEV_GATING_ENABLED: process.env.JEV_GATING_ENABLED ?? "true",
    CRITERIA_PASS_THRESHOLD: process.env.CRITERIA_PASS_THRESHOLD ?? "0.7",
    CRITERIA_CONFIDENCE_FLOOR: process.env.CRITERIA_CONFIDENCE_FLOOR ?? "0.6",
    JEV_DISABLED_TEMPLATES: process.env.JEV_DISABLED_TEMPLATES ?? "[]",
    CORPUS_REPOS: process.env.CORPUS_REPOS ?? "[]",
    GITLAB_BASE_URL: process.env.GITLAB_BASE_URL ?? "https://gitlab.com",
    GITLAB_TOKEN: await SecretRef({ name: "DOWNY_GITLAB_TOKEN" }),
    GITLAB_WEBHOOK_SECRET: await SecretRef({
      name: "DOWNY_GITLAB_WEBHOOK_SECRET",
    }),
    COMPOSIO_API_KEY: await SecretRef({ name: "DOWNY_COMPOSIO_API_KEY" }),
    CREDENTIAL_KEY: await SecretRef({ name: "DOWNY_CREDENTIAL_KEY" }),
    DB: db,
    WORKSPACE_BUCKET: workspaceBucket,
    DownyAgent: downyAgent,
    ChildAgent: childAgent,
    AI: Ai<AiModels>(),
    POLICY_AUD: process.env.POLICY_AUD ?? "",
    TEAM_DOMAIN: process.env.TEAM_DOMAIN ?? "",
    DOWNY_MAX_FETCH_BYTES: process.env.DOWNY_MAX_FETCH_BYTES ?? "26214400",
    MODEL_ID: process.env.MODEL_ID ?? "@cf/moonshotai/kimi-k2.6",
    EXA_API_KEY: alchemy.secret(process.env.EXA_API_KEY),
    // Optional: only used when the `openrouter` AI provider is selected in
    // Settings → Preferences. Both vars must be set explicitly — there is no
    // default model. Read defensively in src/worker/agent/get-model.ts so
    // deploys without them boot fine and only error at turn time.
    ...(process.env.OPENROUTER_API_KEY
      ? { OPENROUTER_API_KEY: alchemy.secret(process.env.OPENROUTER_API_KEY) }
      : {}),
    ...(process.env.OPENROUTER_MODEL_ID
      ? { OPENROUTER_MODEL_ID: process.env.OPENROUTER_MODEL_ID }
      : {}),
    ...(piRelayVpc ? { PI_RELAY_VPC: piRelayVpc } : {}),
  },
});

console.log({ url: worker.url });

await app.finalize();
