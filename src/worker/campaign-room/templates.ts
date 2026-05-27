import type { WorkflowStage } from "../buildroom/workflows";

export type SeedWorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  stages: WorkflowStage[];
};

export const CAMPAIGN_ROOM_TEMPLATE_IDS = [
  "campaign-content-v1",
  "campaign-lead-sourcing-v1",
  "campaign-cold-email-v1",
  "campaign-digest-v1",
] as const;

export const CAMPAIGN_ROOM_TEMPLATES: SeedWorkflowTemplate[] = [
  {
    id: "campaign-content-v1",
    name: "Campaign Room content workflow",
    description:
      "Lightweight GTM content flow: source intake, angle selection, draft, editorial review, and publish package.",
    stages: [
      {
        id: "source-intake",
        name: "Source intake",
        role: "research",
        instructions:
          "Collect source notes, links, claims, audience relevance, and open questions for a GTM content opportunity.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Campaign source notes exist",
          "Audience and source limits are explicit",
        ],
      },
      {
        id: "angle-selection",
        name: "Angle selection",
        role: "main",
        instructions:
          "Select the content angle, target audience, thesis, supporting proof points, and non-goals.",
        requiredArtifact: null,
        gate: "agent_review",
        completionCriteria: [
          "Content brief includes thesis, audience, proof points, and CTA",
        ],
      },
      {
        id: "draft",
        name: "Content draft",
        role: "dreamer",
        instructions:
          "Draft the post, article, newsletter, or founder POV from the approved brief without inventing unsupported claims.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Draft includes format, hook, body, CTA, and variants",
        ],
      },
      {
        id: "editorial-review",
        name: "Editorial review",
        role: "reviewer",
        instructions:
          "Review tone, clarity, factual support, differentiation, and risk before packaging for operator approval.",
        requiredArtifact: null,
        gate: "agent_review",
        completionCriteria: [
          "Editorial review lists changes, risks, and publish readiness",
        ],
      },
      {
        id: "publish-package",
        name: "Publish package",
        role: "operator",
        instructions:
          "Prepare final copy, variants, metadata, source links, and an explicit publish/no-publish recommendation.",
        requiredArtifact: null,
        gate: "operator_confirmation",
        completionCriteria: [
          "Publish package is ready for human-controlled posting",
        ],
      },
    ],
  },
  {
    id: "campaign-lead-sourcing-v1",
    name: "Campaign Room lead sourcing workflow",
    description:
      "Lightweight GTM lead flow: ICP definition, account sourcing, enrichment, qualification, and operator review.",
    stages: [
      {
        id: "icp-definition",
        name: "ICP definition",
        role: "main",
        instructions:
          "Define the target account profile, buying triggers, exclusions, geos, company size, and evidence requirements.",
        requiredArtifact: null,
        gate: "agent_review",
        completionCriteria: [
          "ICP includes fit criteria, exclusions, and evidence fields",
        ],
      },
      {
        id: "account-sourcing",
        name: "Account sourcing",
        role: "research",
        instructions:
          "Find candidate accounts from public sources and record source URLs, why-fit notes, and missing data.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Lead list includes source URLs and why-fit notes",
        ],
      },
      {
        id: "enrichment",
        name: "Enrichment",
        role: "research",
        instructions:
          "Enrich candidates with public context, relevant initiatives, likely buyer roles, and personalization hooks.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: ["Enrichment notes include source-backed context"],
      },
      {
        id: "qualification",
        name: "Qualification",
        role: "reviewer",
        instructions:
          "Score fit, confidence, missing evidence, and recommended next action for each candidate account.",
        requiredArtifact: null,
        gate: "agent_review",
        completionCriteria: [
          "Qualification report ranks accounts and flags uncertainty",
        ],
      },
      {
        id: "operator-review",
        name: "Operator review",
        role: "operator",
        instructions:
          "Package the lead batch for human review, export, or follow-up drafting. Do not contact leads automatically.",
        requiredArtifact: null,
        gate: "operator_confirmation",
        completionCriteria: [
          "Operator-ready lead batch includes approve/reject recommendation",
        ],
      },
    ],
  },
  {
    id: "campaign-cold-email-v1",
    name: "Campaign Room cold email workflow",
    description:
      "Lightweight outbound flow: lead context, personalization, sequence draft, spam/tone review, and operator approval.",
    stages: [
      {
        id: "lead-context",
        name: "Lead context",
        role: "research",
        instructions:
          "Collect account/person context, source links, likely pain points, and reasons this contact may care.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Lead context includes source links and relevance hypothesis",
        ],
      },
      {
        id: "personalization",
        name: "Personalization research",
        role: "research",
        instructions:
          "Identify safe personalization hooks and avoid sensitive, creepy, or unsupported claims.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Personalization notes include safe hooks and excluded hooks",
        ],
      },
      {
        id: "sequence-draft",
        name: "Sequence draft",
        role: "dreamer",
        instructions:
          "Draft a concise outbound sequence with subject lines, first touch, follow-ups, and clear opt-out-friendly tone.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Email sequence includes variants and personalization slots",
        ],
      },
      {
        id: "spam-tone-review",
        name: "Spam and tone review",
        role: "reviewer",
        instructions:
          "Review spamminess, factual claims, tone, compliance risk, and whether personalization feels appropriate.",
        requiredArtifact: null,
        gate: "agent_review",
        completionCriteria: [
          "Risk review includes send/no-send recommendation",
        ],
      },
      {
        id: "operator-approval",
        name: "Operator approval",
        role: "operator",
        instructions:
          "Prepare send-ready copy for human approval. Do not send email automatically.",
        requiredArtifact: null,
        gate: "operator_confirmation",
        completionCriteria: [
          "Send package is explicit that human approval is required",
        ],
      },
    ],
  },
  {
    id: "campaign-digest-v1",
    name: "Campaign Room weekly GTM digest",
    description:
      "Recurring GTM digest flow: source scan, insight extraction, opportunity ranking, and recommended actions.",
    stages: [
      {
        id: "source-scan",
        name: "Source scan",
        role: "research",
        instructions:
          "Scan selected feeds, articles, X/HN/Reddit/GitHub/company sources, and record relevant GTM signals.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: [
          "Digest source notes include sources scanned and limits",
        ],
      },
      {
        id: "insight-extraction",
        name: "Insight extraction",
        role: "main",
        instructions:
          "Extract non-obvious GTM insights, content angles, buyer pain signals, and lead/account opportunities.",
        requiredArtifact: null,
        gate: "none",
        completionCriteria: ["Insights connect sources to GTM implications"],
      },
      {
        id: "opportunity-ranking",
        name: "Opportunity ranking",
        role: "reviewer",
        instructions:
          "Rank opportunities by urgency, evidence, strategic fit, and effort. Flag weak evidence.",
        requiredArtifact: null,
        gate: "agent_review",
        completionCriteria: [
          "Ranked opportunities include confidence and next action",
        ],
      },
      {
        id: "recommended-actions",
        name: "Recommended actions",
        role: "operator",
        instructions:
          "Prepare an operator digest with recommended campaigns, content drafts, lead batches, or research follow-ups.",
        requiredArtifact: null,
        gate: "operator_confirmation",
        completionCriteria: [
          "Digest includes clear approve/defer/drop recommendations",
        ],
      },
    ],
  },
];
