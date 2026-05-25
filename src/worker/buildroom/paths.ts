import type { BuildroomArtifactName } from "./schemas";

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,120}$/;

export function assertSafeBuildroomId(id: string): string {
  if (!SAFE_ID_RE.test(id)) throw new Error(`Invalid buildroom id: ${id}`);
  return id;
}

export function buildroomRoot(): string {
  return "workspace/buildroom";
}

export function buildroomJobPath(jobId: string): string {
  return `${buildroomRoot()}/jobs/${assertSafeBuildroomId(jobId)}`;
}

export function buildroomArtifactPath(
  jobId: string,
  artifactName: BuildroomArtifactName | "job" | "events",
): string {
  const suffix =
    artifactName === "events" ? "events.jsonl" : `${artifactName}.json`;
  return `${buildroomJobPath(jobId)}/${suffix}`;
}
