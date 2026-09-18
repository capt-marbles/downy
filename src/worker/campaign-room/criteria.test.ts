import { expect, it, vi } from "vitest";
import { evaluateCriteria } from "./criteria";
import { advanceCampaignWorkflow } from "./advance";
import { CAMPAIGN_ROOM_TEMPLATES } from "./templates";
import { testDb } from "../../test/d1";
import type { WorkflowStage } from "../buildroom/workflows";
vi.mock("../lib/get-agent", () => ({
  isValidSlug: (slug: string) => /^[a-z][a-z0-9-]+$/.test(slug),
}));
const stage: WorkflowStage = {
  id: "draft",
  name: "Draft",
  role: "dreamer",
  gate: "none",
  requiredArtifact: null,
  campaignArtifact: "campaign-content-draft",
  instructions: "Write a draft",
  completionCriteria: ["Draft includes a CTA"],
};
const config = {
  enabled: true,
  passThreshold: 0.7,
  confidenceFloor: 0.6,
  disabledTemplates: [],
};
const answer = (p: number) => ({
  model: "jev-1.13.0",
  answers: {
    criterion_0: { type: "noul", noul: p },
    quality: {
      type: "score",
      score: 1.5,
      confidence: 0.9,
      probabilities: { "0": 0, "1": 0.5, "2": 0.5 },
      legend: { "0": "Incomplete", "1": "Needs revision", "2": "Clear" },
    },
  },
  usage: { input_tokens: 20, output_tokens: 10 },
});
it("blocks a missing criterion and returns its exact text and probability", async () => {
  const run = vi.fn(async () => answer(0.1));
  const result = await evaluateCriteria({
    stage,
    artifact: "Draft with no call to action",
    config,
    run,
  });
  expect(result.state).toBe("blocked");
  expect(result.failingCriteria[0]).toMatchObject({
    criterion: "Draft includes a CTA",
    probability: 0.1,
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toBeDefined();
});
it("surfaces uncertain criteria and fails open loudly on outages", async () => {
  expect(
    (
      await evaluateCriteria({
        stage,
        artifact: "Draft",
        config,
        run: async () => answer(0.52),
      })
    ).state,
  ).toBe("uncertain");
  const result = await evaluateCriteria({
    stage,
    artifact: "Draft",
    config,
    run: async () => {
      throw new Error("outage");
    },
  });
  expect(result.state).toBe("unavailable");
  expect(result.warning).toContain("Existing gates");
});
it("skips stages without an artifact or criteria and records truncation", async () => {
  const run = vi.fn(async () => answer(0.99));
  expect(
    (
      await evaluateCriteria({
        stage: { ...stage, campaignArtifact: undefined },
        artifact: "",
        config,
        run,
      })
    ).state,
  ).toBe("skipped");
  expect(run).not.toHaveBeenCalled();
  expect(
    (
      await evaluateCriteria({
        stage,
        artifact: "x".repeat(60_000),
        config,
        run,
      })
    ).truncated,
  ).toBe(true);
});
it("passing Jev cannot replace operator confirmation", async () => {
  const db = testDb([
    "0004_buildroom.sql",
    "0005_buildroom_workflows.sql",
    "0013_workflow_criteria_evaluations.sql",
  ]);
  const template = CAMPAIGN_ROOM_TEMPLATES[0];
  const operatorStage = template.stages.find(
    (candidateStage) => candidateStage.gate === "operator_confirmation",
  )!;
  await db
    .prepare(
      "INSERT INTO buildroom_jobs (id,agent_slug,title,stage,status,created_at,updated_at,workspace_path) VALUES ('job','test','Test','intake','active',1,1,'workspace/job')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO buildroom_workflow_templates (id,agent_slug,name,stages_json,created_at,updated_at) VALUES (?,?,?,?,1,1)",
    )
    .bind(template.id, "test", template.name, JSON.stringify(template.stages))
    .run();
  await db
    .prepare(
      "INSERT INTO buildroom_workflow_runs (job_id,template_id,agent_slug,current_stage_id,status,created_at,updated_at) VALUES ('job',?,'test',?,'waiting_for_gate',1,1)",
    )
    .bind(template.id, operatorStage.id)
    .run();
  await db
    .prepare(
      "INSERT INTO buildroom_workflow_stage_runs (id,job_id,agent_slug,stage_id,status,started_at) VALUES ('stage','job','test',?,'waiting_for_gate',1)",
    )
    .bind(operatorStage.id)
    .run();
  // Test fixture supplies only the bindings exercised by this path.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const env = {
    DB: db,
    JEV_GATING_ENABLED: "true",
    CRITERIA_PASS_THRESHOLD: "0.7",
    CRITERIA_CONFIDENCE_FLOOR: "0.6",
    JEV_DISABLED_TEMPLATES: "[]",
  } as Cloudflare.Env;
  const result = await advanceCampaignWorkflow({
    env,
    agentSlug: "test",
    input: {
      jobId: "job",
      completedStageId: operatorStage.id,
      outputArtifactName: null,
      notes: "",
    },
    readFile: async () => "Human approval required",
    run: async () => answer(0.99),
  });
  expect(result.criteria.state).toBe("passed");
  expect(result.advanced).toBe(false);
  expect(result.gateRequired).toBe("operator_confirmation");
  expect(
    (await db.prepare("SELECT * FROM buildroom_workflow_gate_decisions").all())
      .results,
  ).toHaveLength(0);
  expect(
    (
      await db
        .prepare("SELECT jev_model_version FROM workflow_criteria_evaluations")
        .all()
    ).results,
  ).toEqual([
    { jev_model_version: "jev-1.13.0" },
    { jev_model_version: "jev-1.13.0" },
  ]);
});
