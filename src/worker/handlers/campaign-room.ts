import { z } from "zod";

import { createBuildroomJob, listBuildroomJobs } from "../buildroom/db";
import { startBuildroomWorkflow } from "../buildroom/workflow-db";
import { CAMPAIGN_SCHEDULE_PRESETS } from "../campaign-room/schedules";
import { CampaignArtifactNameSchema } from "../campaign-room/schemas";
import { CAMPAIGN_ROOM_TEMPLATES } from "../campaign-room/templates";
import { requestLocalHandsAction } from "../local-hands/db";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError, slugFromRequest } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

const CampaignSmokeInputSchema = z.object({
  campaignName: z.string().min(1).max(120),
  objective: z.string().min(1).max(1000),
  audience: z.string().min(1).max(500),
  thesis: z.string().min(1).max(1000),
  proofPoints: z.array(z.string().min(1).max(500)).max(12).default([]),
  offerOrCta: z.string().max(500).default(""),
  nonGoals: z.array(z.string().min(1).max(500)).max(12).default([]),
  successCriteria: z.array(z.string().min(1).max(500)).max(12).default([]),
  researchQuery: z.string().min(1).max(1000),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function nowIso(): string {
  return new Date().toISOString();
}

function campaignJobTitle(campaignName: string): string {
  return `Campaign Room: ${campaignName}`.slice(0, 160);
}

async function fromRpc<T>(value: T): Promise<T> {
  return value;
}

export async function handleCampaignRoomRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentSlug = slugFromRequest(request);

    if (request.method === "GET" && parts.length === 2) {
      const jobs = (await listBuildroomJobs(env.DB, agentSlug))
        .filter((job) => job.title.startsWith("Campaign Room:"))
        .slice(0, 8);
      return json({
        templates: CAMPAIGN_ROOM_TEMPLATES,
        schedulePresets: CAMPAIGN_SCHEDULE_PRESETS,
        recentJobs: jobs,
      });
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[2] === "artifacts"
    ) {
      const jobId = url.searchParams.get("jobId");
      if (!jobId) return json({ error: "Missing jobId" }, 400);
      const stub = await getActiveAgentStub(request, env);
      const artifacts = await Promise.all(
        CampaignArtifactNameSchema.options.map(async (artifactName) => ({
          artifactName,
          artifact: await stub.readCampaignArtifact(jobId, artifactName),
        })),
      );
      return json({
        artifacts: artifacts.filter((entry) => entry.artifact !== null),
      });
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[2] === "smoke"
    ) {
      const input = CampaignSmokeInputSchema.parse(await request.json());
      const createdAt = nowIso();
      const job = await createBuildroomJob(env.DB, {
        agentSlug,
        input: {
          title: campaignJobTitle(input.campaignName),
          actorRole: "main",
        },
      });
      const workflow = await startBuildroomWorkflow(env.DB, {
        agentSlug,
        input: {
          templateId: "campaign-content-v1",
          title: campaignJobTitle(input.campaignName),
          actorRole: "main",
        },
      });
      const stub = await getActiveAgentStub(request, env);
      const brief = await fromRpc(
        stub.writeCampaignArtifact(job.id, {
          schema_version: 1,
          job_id: job.id,
          agent_slug: agentSlug,
          created_at: createdAt,
          created_by: "campaign-room-api",
          artifact_type: "campaign-brief",
          campaign_name: input.campaignName,
          objective: input.objective,
          audience: input.audience,
          thesis: input.thesis,
          proof_points: input.proofPoints,
          offer_or_cta: input.offerOrCta,
          non_goals: input.nonGoals,
          success_criteria: input.successCriteria,
        }),
      );
      const researchAction = await requestLocalHandsAction(env.DB, {
        agentSlug,
        input: {
          kind: "grok.research",
          riskLevel: "read_only",
          requiresConfirmation: false,
          requestedBy: "campaign-room",
          input: {
            query: input.researchQuery,
            mode: "research_summary",
            maxResults: 20,
            outputArtifact: "campaign-source-notes",
            context: {
              jobId: job.id,
              workflowJobId: workflow.run.jobId,
              campaignName: input.campaignName,
              objective: input.objective,
              audience: input.audience,
              thesis: input.thesis,
            },
          },
        },
      });
      const sourceNotes = await fromRpc(
        stub.writeCampaignArtifact(job.id, {
          schema_version: 1,
          job_id: job.id,
          agent_slug: agentSlug,
          created_at: createdAt,
          created_by: "campaign-room-api",
          artifact_type: "campaign-source-notes",
          summary: `Research requested from local hands action ${researchAction.id}.`,
          sources: [],
          claims: [],
          opportunities: [],
          open_questions: ["Waiting for local Grok/X research result."],
          research_limits:
            "Placeholder source notes created by smoke path. Replace or enrich after the local hands research action completes.",
        }),
      );
      return json(
        {
          job,
          workflow,
          brief,
          researchAction,
          sourceNotes,
        },
        201,
      );
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/campaign-room] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
