import { createBuildroomJob } from "./db";
import { CAMPAIGN_ROOM_TEMPLATES } from "../campaign-room/templates";
import {
  BuildroomWorkflowDetailSchema,
  DEFAULT_BUILDROOM_WORKFLOW_STAGES,
  WorkflowGateRecordSchema,
  WorkflowRunSchema,
  WorkflowStageRunSchema,
  WorkflowTemplateSchema,
  type AdvanceWorkflowInput,
  type BuildroomWorkflowDetail,
  type CreateWorkflowTemplateInput,
  type RecordGateDecisionInput,
  type StartWorkflowInput,
  type WorkflowGateRecord,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowStage,
  type WorkflowStageRun,
  type WorkflowStageRunStatus,
  type WorkflowTemplate,
} from "./workflows";

const DEFAULT_TEMPLATE_ID = "buildroom-standard-v1";

const SEED_WORKFLOW_TEMPLATES = [
  {
    id: DEFAULT_TEMPLATE_ID,
    name: "Buildroom standard workflow",
    description:
      "Research, idea, gated planning, coding, QA, trust, retention, and operator closeout.",
    stages: DEFAULT_BUILDROOM_WORKFLOW_STAGES,
  },
  ...CAMPAIGN_ROOM_TEMPLATES,
];

type TemplateRow = {
  id: string;
  agent_slug: string;
  name: string;
  description: string;
  version: number;
  stages_json: string;
  is_archived: number;
  created_at: number;
  updated_at: number;
};

type RunRow = {
  job_id: string;
  template_id: string;
  agent_slug: string;
  current_stage_id: string;
  status: WorkflowRunStatus;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type StageRunRow = {
  id: string;
  job_id: string;
  agent_slug: string;
  stage_id: string;
  status: WorkflowStageRunStatus;
  started_at: number;
  completed_at: number | null;
  output_artifact_name: string | null;
  notes: string | null;
};

type GateRow = {
  id: string;
  job_id: string;
  agent_slug: string;
  stage_id: string;
  gate_type: "none" | "agent_review" | "operator_confirmation";
  decision: "approved" | "rejected" | "needs_changes";
  decided_by: string;
  reason: string;
  created_at: number;
};

function slugPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workflow"
  );
}

function parseStages(value: string): WorkflowStage[] {
  return WorkflowTemplateSchema.shape.stages.parse(
    JSON.parse(value) as unknown,
  );
}

function rowToTemplate(row: TemplateRow): WorkflowTemplate {
  return WorkflowTemplateSchema.parse({
    id: row.id,
    agentSlug: row.agent_slug,
    name: row.name,
    description: row.description,
    version: row.version,
    stages: parseStages(row.stages_json),
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToRun(row: RunRow): WorkflowRun {
  return WorkflowRunSchema.parse({
    jobId: row.job_id,
    templateId: row.template_id,
    agentSlug: row.agent_slug,
    currentStageId: row.current_stage_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

function rowToStageRun(row: StageRunRow): WorkflowStageRun {
  return WorkflowStageRunSchema.parse({
    id: row.id,
    jobId: row.job_id,
    agentSlug: row.agent_slug,
    stageId: row.stage_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outputArtifactName: row.output_artifact_name,
    notes: row.notes,
  });
}

function rowToGate(row: GateRow): WorkflowGateRecord {
  return WorkflowGateRecordSchema.parse({
    id: row.id,
    jobId: row.job_id,
    agentSlug: row.agent_slug,
    stageId: row.stage_id,
    gateType: row.gate_type,
    decision: row.decision,
    decidedBy: row.decided_by,
    reason: row.reason,
    createdAt: row.created_at,
  });
}

function findStage(template: WorkflowTemplate, stageId: string): WorkflowStage {
  const stage = template.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`Unknown workflow stage: ${stageId}`);
  return stage;
}

function nextStage(
  template: WorkflowTemplate,
  currentStageId: string,
): WorkflowStage | null {
  const index = template.stages.findIndex(
    (stage) => stage.id === currentStageId,
  );
  if (index < 0) throw new Error(`Unknown workflow stage: ${currentStageId}`);
  return template.stages[index + 1] ?? null;
}

async function insertStageRun(
  db: D1Database,
  args: {
    jobId: string;
    agentSlug: string;
    stage: WorkflowStage;
    status: WorkflowStageRunStatus;
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO buildroom_workflow_stage_runs (
        id, job_id, agent_slug, stage_id, status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      args.jobId,
      args.agentSlug,
      args.stage.id,
      args.status,
      args.now,
    )
    .run();
}

async function upsertSeedWorkflowTemplate(
  db: D1Database,
  agentSlug: string,
  seed: (typeof SEED_WORKFLOW_TEMPLATES)[number],
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO buildroom_workflow_templates (
        id, agent_slug, name, description, version, stages_json,
        is_archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      seed.id,
      agentSlug,
      seed.name,
      seed.description,
      1,
      JSON.stringify(seed.stages),
      0,
      now,
      now,
    )
    .run();
}

export async function ensureDefaultWorkflowTemplates(
  db: D1Database,
  agentSlug: string,
): Promise<WorkflowTemplate[]> {
  for (const seed of SEED_WORKFLOW_TEMPLATES) {
    const existing = await getWorkflowTemplate(db, seed.id);
    if (!existing) await upsertSeedWorkflowTemplate(db, agentSlug, seed);
  }
  return Promise.all(
    SEED_WORKFLOW_TEMPLATES.map(async (seed) => {
      const template = await getWorkflowTemplate(db, seed.id);
      if (!template)
        throw new Error(`Failed to create workflow template ${seed.id}`);
      return template;
    }),
  );
}

export async function ensureDefaultWorkflowTemplate(
  db: D1Database,
  agentSlug: string,
): Promise<WorkflowTemplate> {
  await ensureDefaultWorkflowTemplates(db, agentSlug);
  const template = await getWorkflowTemplate(db, DEFAULT_TEMPLATE_ID);
  if (!template) throw new Error("Failed to create default workflow template");
  return template;
}

export async function createWorkflowTemplate(
  db: D1Database,
  args: { agentSlug: string; input: CreateWorkflowTemplateInput },
): Promise<WorkflowTemplate> {
  const now = Date.now();
  const id = `${slugPart(args.input.name)}-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(
      `INSERT INTO buildroom_workflow_templates (
        id, agent_slug, name, description, version, stages_json,
        is_archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      args.agentSlug,
      args.input.name,
      args.input.description,
      1,
      JSON.stringify(args.input.stages),
      0,
      now,
      now,
    )
    .run();
  const template = await getWorkflowTemplate(db, id);
  if (!template) throw new Error("Failed to create workflow template");
  return template;
}

export async function getWorkflowTemplate(
  db: D1Database,
  templateId: string,
): Promise<WorkflowTemplate | null> {
  const row = await db
    .prepare("SELECT * FROM buildroom_workflow_templates WHERE id = ?")
    .bind(templateId)
    .first<TemplateRow>();
  return row ? rowToTemplate(row) : null;
}

export async function listWorkflowTemplates(
  db: D1Database,
  agentSlug: string,
): Promise<WorkflowTemplate[]> {
  await ensureDefaultWorkflowTemplates(db, agentSlug);
  const seedTemplateIds = SEED_WORKFLOW_TEMPLATES.map(
    (template) => template.id,
  );
  const placeholders = seedTemplateIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM buildroom_workflow_templates
       WHERE (agent_slug = ? OR id IN (${placeholders})) AND is_archived = 0
       ORDER BY updated_at DESC`,
    )
    .bind(agentSlug, ...seedTemplateIds)
    .all<TemplateRow>();
  return (result.results ?? []).map(rowToTemplate);
}

export async function startBuildroomWorkflow(
  db: D1Database,
  args: { agentSlug: string; input: StartWorkflowInput },
): Promise<BuildroomWorkflowDetail> {
  await ensureDefaultWorkflowTemplates(db, args.agentSlug);
  const template = await getWorkflowTemplate(db, args.input.templateId);
  if (!template)
    throw new Error(`Unknown workflow template: ${args.input.templateId}`);
  if (template.stages.length === 0)
    throw new Error("Workflow template has no stages");
  const job = await createBuildroomJob(db, {
    agentSlug: args.agentSlug,
    input: { title: args.input.title, actorRole: args.input.actorRole },
  });
  const firstStage = template.stages[0];
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO buildroom_workflow_runs (
        job_id, template_id, agent_slug, current_stage_id, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      job.id,
      template.id,
      args.agentSlug,
      firstStage.id,
      firstStage.gate === "none" ? "active" : "waiting_for_gate",
      now,
      now,
    )
    .run();
  await insertStageRun(db, {
    jobId: job.id,
    agentSlug: args.agentSlug,
    stage: firstStage,
    status: firstStage.gate === "none" ? "active" : "waiting_for_gate",
    now,
  });
  return getWorkflowDetailOrThrow(db, job.id);
}

export async function getWorkflowDetailOrThrow(
  db: D1Database,
  jobId: string,
): Promise<BuildroomWorkflowDetail> {
  const runRow = await db
    .prepare("SELECT * FROM buildroom_workflow_runs WHERE job_id = ?")
    .bind(jobId)
    .first<RunRow>();
  if (!runRow) throw new Error(`No workflow run for job: ${jobId}`);
  const run = rowToRun(runRow);
  const template = await getWorkflowTemplate(db, run.templateId);
  if (!template)
    throw new Error(`Missing workflow template: ${run.templateId}`);
  const currentStage = findStage(template, run.currentStageId);
  const stageRows = await db
    .prepare(
      `SELECT * FROM buildroom_workflow_stage_runs
       WHERE job_id = ? ORDER BY started_at ASC`,
    )
    .bind(jobId)
    .all<StageRunRow>();
  const gateRows = await db
    .prepare(
      `SELECT * FROM buildroom_workflow_gate_decisions
       WHERE job_id = ? ORDER BY created_at ASC`,
    )
    .bind(jobId)
    .all<GateRow>();
  return BuildroomWorkflowDetailSchema.parse({
    template,
    run,
    stageRuns: (stageRows.results ?? []).map(rowToStageRun),
    gateDecisions: (gateRows.results ?? []).map(rowToGate),
    currentStage,
  });
}

export async function advanceBuildroomWorkflow(
  db: D1Database,
  input: AdvanceWorkflowInput,
): Promise<BuildroomWorkflowDetail> {
  const detail = await getWorkflowDetailOrThrow(db, input.jobId);
  if (detail.run.status === "blocked" || detail.run.status === "completed") {
    throw new Error(`Workflow cannot advance from ${detail.run.status}`);
  }
  if (detail.run.currentStageId !== input.completedStageId) {
    throw new Error(
      `Current stage is ${detail.run.currentStageId}, not ${input.completedStageId}`,
    );
  }
  const expectedArtifact = detail.currentStage.requiredArtifact;
  if (expectedArtifact && input.outputArtifactName !== expectedArtifact) {
    throw new Error(
      `Stage ${detail.currentStage.id} requires artifact ${expectedArtifact}`,
    );
  }
  const now = Date.now();
  await db
    .prepare(
      `UPDATE buildroom_workflow_stage_runs
       SET status = ?, completed_at = ?, output_artifact_name = ?, notes = ?
       WHERE job_id = ? AND stage_id = ? AND completed_at IS NULL`,
    )
    .bind(
      "completed",
      now,
      input.outputArtifactName,
      input.notes,
      input.jobId,
      input.completedStageId,
    )
    .run();
  const next = nextStage(detail.template, input.completedStageId);
  if (!next) {
    await db
      .prepare(
        `UPDATE buildroom_workflow_runs
         SET status = ?, updated_at = ?, completed_at = ?
         WHERE job_id = ?`,
      )
      .bind("completed", now, now, input.jobId)
      .run();
    return getWorkflowDetailOrThrow(db, input.jobId);
  }
  const nextStatus: WorkflowRunStatus =
    next.gate === "none" ? "active" : "waiting_for_gate";
  await db
    .prepare(
      `UPDATE buildroom_workflow_runs
       SET current_stage_id = ?, status = ?, updated_at = ?
       WHERE job_id = ?`,
    )
    .bind(next.id, nextStatus, now, input.jobId)
    .run();
  await insertStageRun(db, {
    jobId: input.jobId,
    agentSlug: detail.run.agentSlug,
    stage: next,
    status: nextStatus === "active" ? "active" : "waiting_for_gate",
    now,
  });
  return getWorkflowDetailOrThrow(db, input.jobId);
}

export async function recordWorkflowGateDecision(
  db: D1Database,
  input: RecordGateDecisionInput,
): Promise<BuildroomWorkflowDetail> {
  const detail = await getWorkflowDetailOrThrow(db, input.jobId);
  const stage = findStage(detail.template, input.stageId);
  if (stage.gate === "none") throw new Error(`${stage.id} has no gate`);
  if (detail.run.currentStageId !== stage.id) {
    throw new Error(
      `Current stage is ${detail.run.currentStageId}, not ${stage.id}`,
    );
  }
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO buildroom_workflow_gate_decisions (
        id, job_id, agent_slug, stage_id, gate_type, decision,
        decided_by, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.jobId,
      detail.run.agentSlug,
      stage.id,
      stage.gate,
      input.decision,
      input.decidedBy,
      input.reason,
      now,
    )
    .run();
  const status: WorkflowRunStatus =
    input.decision === "approved"
      ? "active"
      : input.decision === "needs_changes"
        ? "waiting_for_gate"
        : "blocked";
  await db
    .prepare(
      `UPDATE buildroom_workflow_runs
       SET status = ?, updated_at = ?
       WHERE job_id = ?`,
    )
    .bind(status, now, input.jobId)
    .run();
  await db
    .prepare(
      `UPDATE buildroom_workflow_stage_runs
       SET status = ?, notes = ?
       WHERE job_id = ? AND stage_id = ? AND completed_at IS NULL`,
    )
    .bind(
      status === "blocked" ? "blocked" : "active",
      input.reason,
      input.jobId,
      stage.id,
    )
    .run();
  return getWorkflowDetailOrThrow(db, input.jobId);
}
