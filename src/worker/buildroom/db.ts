import { isValidSlug } from "../lib/get-agent";
import { buildroomJobPath } from "./paths";
import {
  BuildroomEventSchema,
  BuildroomJobSchema,
  type BuildroomArtifactName,
  type BuildroomEvent,
  type BuildroomJob,
  type BuildroomRole,
  type BuildroomStage,
  type BuildroomStatus,
  type CreateBuildroomJobInput,
} from "./schemas";

type BuildroomJobRow = {
  id: string;
  agent_slug: string;
  title: string;
  stage: BuildroomStage;
  status: BuildroomStatus;
  risk_band: string | null;
  trust_state: string | null;
  retention_recommendation: string | null;
  owner_role: BuildroomRole | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  workspace_path: string;
};

type BuildroomEventRow = {
  id: string;
  job_id: string;
  agent_slug: string;
  actor_slug: string;
  actor_role: BuildroomRole;
  event_type: string;
  from_stage: BuildroomStage | null;
  to_stage: BuildroomStage | null;
  artifact_name: BuildroomArtifactName | null;
  message: string | null;
  created_at: number;
};

function rowToJob(row: BuildroomJobRow): BuildroomJob {
  return BuildroomJobSchema.parse({
    id: row.id,
    agentSlug: row.agent_slug,
    title: row.title,
    stage: row.stage,
    status: row.status,
    riskBand: row.risk_band,
    trustState: row.trust_state,
    retentionRecommendation: row.retention_recommendation,
    ownerRole: row.owner_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    workspacePath: row.workspace_path,
  });
}

function rowToEvent(row: BuildroomEventRow): BuildroomEvent {
  return BuildroomEventSchema.parse({
    id: row.id,
    jobId: row.job_id,
    agentSlug: row.agent_slug,
    actorSlug: row.actor_slug,
    actorRole: row.actor_role,
    eventType: row.event_type,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    artifactName: row.artifact_name,
    message: row.message,
    createdAt: row.created_at,
  });
}

function slugPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "job"
  );
}

export async function createBuildroomJob(
  db: D1Database,
  args: { agentSlug: string; input: CreateBuildroomJobInput },
): Promise<BuildroomJob> {
  if (!isValidSlug(args.agentSlug) && args.agentSlug !== "default") {
    throw new Error(`Invalid agent slug: ${args.agentSlug}`);
  }
  const now = Date.now();
  const id = `${new Date(now).toISOString().slice(0, 10).replaceAll("-", "")}-${slugPart(args.input.title)}-${crypto.randomUUID().slice(0, 8)}`;
  const workspacePath = buildroomJobPath(id);
  await db
    .prepare(
      `INSERT INTO buildroom_jobs (
        id, agent_slug, title, stage, status, owner_role,
        created_at, updated_at, workspace_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      args.agentSlug,
      args.input.title,
      "created",
      "active",
      args.input.actorRole,
      now,
      now,
      workspacePath,
    )
    .run();
  await appendBuildroomEvent(db, {
    jobId: id,
    agentSlug: args.agentSlug,
    actorSlug: args.agentSlug,
    actorRole: args.input.actorRole,
    eventType: "job_created",
    fromStage: null,
    toStage: "created",
    artifactName: null,
    message: args.input.title,
    createdAt: now,
  });
  const job = await getBuildroomJob(db, id);
  if (!job) throw new Error("Failed to read back buildroom job");
  return job;
}

export async function getBuildroomJob(
  db: D1Database,
  id: string,
): Promise<BuildroomJob | null> {
  const row = await db
    .prepare("SELECT * FROM buildroom_jobs WHERE id = ?")
    .bind(id)
    .first<BuildroomJobRow>();
  return row ? rowToJob(row) : null;
}

export async function listBuildroomJobs(
  db: D1Database,
  agentSlug: string,
): Promise<BuildroomJob[]> {
  const result = await db
    .prepare(
      `SELECT * FROM buildroom_jobs
       WHERE agent_slug = ?
       ORDER BY updated_at DESC`,
    )
    .bind(agentSlug)
    .all<BuildroomJobRow>();
  return (result.results ?? []).map(rowToJob);
}

export async function updateBuildroomJobStage(
  db: D1Database,
  args: {
    job: BuildroomJob;
    stage: BuildroomStage;
    artifactName: BuildroomArtifactName;
    actorSlug: string;
    actorRole: BuildroomRole;
    message?: string;
  },
): Promise<BuildroomJob> {
  const now = Date.now();
  const status: BuildroomStatus =
    args.stage === "closed"
      ? "closed"
      : args.stage === "blocked"
        ? "blocked"
        : "active";
  await db
    .prepare(
      `UPDATE buildroom_jobs
       SET stage = ?, status = ?, updated_at = ?, closed_at = ?
       WHERE id = ?`,
    )
    .bind(
      args.stage,
      status,
      now,
      args.stage === "closed" ? now : args.job.closedAt,
      args.job.id,
    )
    .run();
  await appendBuildroomEvent(db, {
    jobId: args.job.id,
    agentSlug: args.job.agentSlug,
    actorSlug: args.actorSlug,
    actorRole: args.actorRole,
    eventType: "artifact_written",
    fromStage: args.job.stage,
    toStage: args.stage,
    artifactName: args.artifactName,
    message: args.message ?? null,
    createdAt: now,
  });
  const updated = await getBuildroomJob(db, args.job.id);
  if (!updated) throw new Error(`Unknown buildroom job: ${args.job.id}`);
  return updated;
}

export async function listBuildroomEvents(
  db: D1Database,
  jobId: string,
): Promise<BuildroomEvent[]> {
  const result = await db
    .prepare(
      `SELECT * FROM buildroom_events
       WHERE job_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(jobId)
    .all<BuildroomEventRow>();
  return (result.results ?? []).map(rowToEvent);
}

async function appendBuildroomEvent(
  db: D1Database,
  args: Omit<BuildroomEvent, "id">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO buildroom_events (
        id, job_id, agent_slug, actor_slug, actor_role, event_type,
        from_stage, to_stage, artifact_name, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      args.jobId,
      args.agentSlug,
      args.actorSlug,
      args.actorRole,
      args.eventType,
      args.fromStage,
      args.toStage,
      args.artifactName,
      args.message,
      args.createdAt,
    )
    .run();
}
