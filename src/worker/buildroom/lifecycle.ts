import { MainReviewSchema } from "./schemas";
import type {
  BuildroomArtifactName,
  BuildroomRole,
  BuildroomStage,
} from "./schemas";

export type ArtifactTransition = {
  from: BuildroomStage[];
  to: BuildroomStage;
  roles: BuildroomRole[];
};

export const ARTIFACT_TRANSITIONS: Record<
  BuildroomArtifactName,
  ArtifactTransition
> = {
  "research-input": {
    from: ["created", "research_collected"],
    to: "research_collected",
    roles: ["research", "main", "operator"],
  },
  "idea-contract": {
    from: ["research_collected", "idea_proposed"],
    to: "idea_proposed",
    roles: ["dreamer", "main", "operator"],
  },
  "intent-review": {
    from: ["idea_proposed", "intent_reviewed"],
    to: "intent_reviewed",
    roles: ["main", "reviewer", "operator"],
  },
  "main-review": {
    from: ["intent_reviewed", "approved_for_planning", "blocked"],
    to: "approved_for_planning",
    roles: ["main", "operator"],
  },
  "product-plan": {
    from: ["approved_for_planning", "product_planned"],
    to: "product_planned",
    roles: ["main", "operator"],
  },
  "build-plan": {
    from: ["approved_for_coder", "build_planned"],
    to: "build_planned",
    roles: ["coder", "operator"],
  },
  verification: {
    from: ["build_planned", "implemented", "coder_verified"],
    to: "coder_verified",
    roles: ["coder", "operator"],
  },
  "qa-verification": {
    from: ["coder_verified", "qa_verified"],
    to: "qa_verified",
    roles: ["qa", "operator"],
  },
  "verification-delta": {
    from: ["qa_verified", "verification_delta_recorded"],
    to: "verification_delta_recorded",
    roles: ["qa", "operator"],
  },
  "trust-report": {
    from: ["verification_delta_recorded", "trust_reported"],
    to: "trust_reported",
    roles: ["trust", "operator"],
  },
  "retention-review": {
    from: ["trust_reported", "retention_reviewed"],
    to: "retention_reviewed",
    roles: ["retention", "operator"],
  },
  "operator-summary": {
    from: ["retention_reviewed", "closed"],
    to: "closed",
    roles: ["main", "operator"],
  },
};

export function nextStageForArtifact(args: {
  artifactName: BuildroomArtifactName;
  currentStage: BuildroomStage;
  actorRole: BuildroomRole;
  artifact: unknown;
}): BuildroomStage {
  const transition = ARTIFACT_TRANSITIONS[args.artifactName];
  if (!transition.roles.includes(args.actorRole)) {
    throw new Error(`${args.actorRole} cannot write ${args.artifactName}`);
  }
  if (!transition.from.includes(args.currentStage)) {
    throw new Error(
      `${args.artifactName} cannot be written while job is ${args.currentStage}`,
    );
  }
  if (args.artifactName === "main-review") {
    const decision = MainReviewSchema.parse(args.artifact).decision;
    if (decision === "blocked") return "blocked";
    if (decision === "approved_for_coder") return "approved_for_coder";
    if (decision === "approved_for_planning") return "approved_for_planning";
  }
  return transition.to;
}
