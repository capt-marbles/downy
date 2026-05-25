import { tool } from "ai";
import { z } from "zod";

import {
  advanceBuildroomWorkflow,
  createWorkflowTemplate,
  getWorkflowDetailOrThrow,
  listWorkflowTemplates,
  recordWorkflowGateDecision,
  startBuildroomWorkflow,
} from "../../buildroom/workflow-db";
import {
  AdvanceWorkflowInputSchema,
  CreateWorkflowTemplateInputSchema,
  RecordGateDecisionInputSchema,
  StartWorkflowInputSchema,
} from "../../buildroom/workflows";

export function createListBuildroomWorkflowTemplatesTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "List Buildroom workflow templates, including the standard research-to-closeout workflow. Use this before starting a workflow.",
    inputSchema: z.object({}),
    execute: async () => ({
      templates: await listWorkflowTemplates(args.db, args.agentSlug),
    }),
  });
}

export function createCreateBuildroomWorkflowTemplateTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Create a reusable Buildroom workflow template with ordered stages, roles, required artifacts, completion criteria, and gates.",
    inputSchema: CreateWorkflowTemplateInputSchema,
    execute: async (input) => ({
      template: await createWorkflowTemplate(args.db, {
        agentSlug: args.agentSlug,
        input,
      }),
    }),
  });
}

export function createStartBuildroomWorkflowTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Start a Buildroom workflow from a template. This creates the underlying Buildroom job and initializes the first stage run.",
    inputSchema: StartWorkflowInputSchema,
    execute: async (input) => ({
      workflow: await startBuildroomWorkflow(args.db, {
        agentSlug: args.agentSlug,
        input,
      }),
    }),
  });
}

export function createGetBuildroomWorkflowTool(args: { db: D1Database }) {
  return tool({
    description:
      "Read a Buildroom workflow's template, current stage, stage run history, and gate decisions by job id.",
    inputSchema: z.object({ jobId: z.string().min(1) }),
    execute: async ({ jobId }) => ({
      workflow: await getWorkflowDetailOrThrow(args.db, jobId),
    }),
  });
}

export function createAdvanceBuildroomWorkflowTool(args: { db: D1Database }) {
  return tool({
    description:
      "Mark the current Buildroom workflow stage complete and move to the next stage. The outputArtifactName must match the stage's required artifact when one is specified.",
    inputSchema: AdvanceWorkflowInputSchema,
    execute: async (input) => ({
      workflow: await advanceBuildroomWorkflow(args.db, input),
    }),
  });
}

export function createRecordBuildroomGateDecisionTool(args: {
  db: D1Database;
}) {
  return tool({
    description:
      "Record an agent or operator gate decision for the current Buildroom workflow stage. Use rejected for blocked work and needs_changes when the current stage needs revision.",
    inputSchema: RecordGateDecisionInputSchema,
    execute: async (input) => ({
      workflow: await recordWorkflowGateDecision(args.db, input),
    }),
  });
}
