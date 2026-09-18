-- Retire the engineering seed; preserve Campaign Room and user templates/jobs.
DELETE FROM buildroom_workflow_gate_decisions WHERE job_id IN (
  SELECT job_id FROM buildroom_workflow_runs WHERE template_id = 'buildroom-standard-v1'
);
DELETE FROM buildroom_workflow_stage_runs WHERE job_id IN (
  SELECT job_id FROM buildroom_workflow_runs WHERE template_id = 'buildroom-standard-v1'
);
DELETE FROM buildroom_workflow_runs WHERE template_id = 'buildroom-standard-v1';
DELETE FROM buildroom_workflow_templates WHERE id = 'buildroom-standard-v1';
