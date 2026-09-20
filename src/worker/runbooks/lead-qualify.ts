import { z } from "zod";

import {
  JevResponseSchema,
  withDeadline,
  type JevQuestion,
  type JevRunner,
} from "../jev/client";

/**
 * Lead qualification for Gameye's lead-sourcing runbook.
 *
 * The Hyperagent runbook asks the model to sort candidates into Tier A, Tier B
 * or drop by reading a rubric in prose. Here Jev answers one typed question
 * per rubric axis for each candidate and code composes tier, priority and Fit
 * Score the way qualify.py did. The rubric is therefore fixed between runs,
 * every candidate gets the same questions, and the numbers are reproducible.
 * Jev never writes anything: the caller decides what to do with the verdicts.
 */

export const LeadCandidateSchema = z
  .object({
    id: z.string().min(1).max(80),
    studio: z.string().min(1).max(200),
    game: z.string().max(200).optional(),
    url: z.string().url().max(2_000),
    title: z.string().max(300).optional(),
    snippet: z.string().min(1).max(3_000),
    publishedDate: z.string().max(40).optional(),
    source: z.string().max(60).optional(),
  })
  .strict();
export type LeadCandidate = z.infer<typeof LeadCandidateSchema>;

const MULTIPLAYER = {
  realtime_online:
    "Real-time online multiplayer with server-authoritative play: shooter, extraction, battle royale, MOBA, survival PvP, MMO, racing, sports",
  online_coop_small: "Small online co-op or PvE for roughly 2 to 8 players",
  online_low_intensity:
    "Online but turn-based, card, board, async or idle play with little server intensity",
  local_or_single:
    "Local, split-screen, hotseat or single-player only; nothing to host",
  unclear: "The text does not say what kind of multiplayer, if any",
} as const;
type MultiplayerType = keyof typeof MULTIPLAYER;
const MULTIPLAYER_KEYS: readonly MultiplayerType[] = [
  "realtime_online",
  "online_coop_small",
  "online_low_intensity",
  "local_or_single",
  "unclear",
];

const COMPETITORS = {
  none: "No hosting or orchestration vendor is named",
  gamelift: "Amazon GameLift",
  hathora: "Hathora",
  edgegap: "Edgegap",
  unity_multiplay: "Unity Multiplay or GameFabric",
  agones: "Agones or Kubernetes orchestration",
  playfab: "PlayFab or AccelByte",
  nakama: "Nakama or Heroic Labs",
  self_managed: "Their own servers or cloud instances",
  other: "Another named vendor",
} as const;
type Competitor = keyof typeof COMPETITORS;
const COMPETITOR_KEYS: readonly Competitor[] = [
  "none",
  "gamelift",
  "hathora",
  "edgegap",
  "unity_multiplay",
  "agones",
  "playfab",
  "nakama",
  "self_managed",
  "other",
];

const LAUNCH_LEVELS = [
  "No timing signal",
  "In development, no date",
  "Playtest, beta, early access or launch within months",
  "Launching now or already live and scaling",
] as const;

const QUESTIONS: Record<string, JevQuestion> = {
  multiplayer_type: {
    type: "choice",
    instructions:
      "Which best describes the multiplayer architecture of the game this text is about? Judge only from the text.",
    criteria: MULTIPLAYER,
  },
  launch_proximity: {
    type: "score",
    instructions:
      "How close is this game to needing live servers, according to the text?",
    criteria: [...LAUNCH_LEVELS],
  },
  server_pain: {
    type: "noul",
    instructions:
      "Does the text contain explicit server or infrastructure language: scaling, regional latency, server crashes, dedicated servers, netcode, or migrating off a hosting vendor?",
    criteria: {
      true: "Servers, scaling, latency, crashes, netcode or a hosting vendor are mentioned as a concern or a need",
      false: "No server or infrastructure language",
    },
  },
  funded_or_backed: {
    type: "noul",
    instructions:
      "Is the studio funded, publisher-backed, or an established studio with a track record, according to the text?",
    criteria: {
      true: "A publisher, funding round, investor or well-known prior titles are named",
      false: "No sign of funding, a publisher or an established track record",
    },
  },
  is_studio_signal: {
    type: "noul",
    instructions:
      "Is this text from or about a specific game studio or developer and its own game, rather than a player complaint, a reviewer, a news aggregator, or general industry commentary?",
    criteria: {
      true: "A specific studio or developer and its own game are the subject",
      false:
        "A player, reviewer, aggregator, list article, or general commentary",
    },
  },
  excluded: {
    type: "noul",
    instructions:
      "Does any exclusion apply: a crypto, web3 or token game; a first-party studio owned by Xbox, PlayStation or Nintendo with its own cloud; or the company itself is a hosting, orchestration or backend vendor rather than a game studio?",
    criteria: {
      true: "Crypto or web3 game, platform-owned first-party studio, or an infrastructure vendor",
      false: "An independent or publisher-backed game studio",
    },
  },
  competitor: {
    type: "choice",
    instructions:
      "Which hosting or orchestration vendor, if any, does the text say the studio uses or is leaving?",
    criteria: COMPETITORS,
  },
};

type LeadVerdict = {
  id: string;
  studio: string;
  decision: "keep" | "drop" | "needs_review";
  tier: "A" | "B" | null;
  priority: "High" | "Medium" | "Low" | null;
  icpFit: "High" | "Medium" | "Low" | null;
  fitScore: number;
  multiplayerType: MultiplayerType;
  multiplayerConfidence: number;
  launchProximity: number;
  serverPain: number;
  fundedOrBacked: number;
  isStudioSignal: number;
  excluded: number;
  competitor: Competitor;
  currentInfra: string;
  reasons: string[];
  model: string;
};

type QualifyConfig = {
  /** Below this, the multiplayer-type answer is not trusted and the lead is reviewed. */
  confidenceFloor: number;
  deadlineMs: number;
  concurrency: number;
};

const DEFAULT_QUALIFY_CONFIG: QualifyConfig = {
  confidenceFloor: 0.6,
  deadlineMs: 8_000,
  concurrency: 6,
};

const NEED: Record<MultiplayerType, number> = {
  realtime_online: 0.85,
  online_coop_small: 0.6,
  online_low_intensity: 0.3,
  local_or_single: 0.05,
  unclear: 0.3,
};

const INFRA: Record<Competitor, string> = {
  none: "Unknown",
  gamelift: "GameLift",
  hathora: "Hathora",
  edgegap: "Edgegap",
  unity_multiplay: "Unity Multiplay",
  agones: "Self-managed",
  playfab: "Unknown",
  nakama: "Unknown",
  self_managed: "Self-managed",
  other: "Unknown",
};

const choiceOf = <T extends string>(
  answer: unknown,
  keys: readonly T[],
): { key: T; confidence: number } => {
  const parsed = z
    .object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number(),
    })
    .parse(answer);
  const key = keys.find((k) => k === parsed.choice);
  if (!key) throw new Error(`Unoffered choice: ${parsed.choice}`);
  return { key, confidence: parsed.confidence };
};
const noulOf = (answer: unknown): number =>
  z.object({ type: z.literal("noul"), noul: z.number() }).parse(answer).noul;
const scoreOf = (answer: unknown): number =>
  z.object({ type: z.literal("score"), score: z.number() }).parse(answer).score;

/**
 * Compose the verdict from typed answers. Exported so the policy is unit
 * tested without a model: thresholds live here, not in a prompt.
 */
export function composeVerdict(
  candidate: LeadCandidate,
  response: z.infer<typeof JevResponseSchema>,
  confidenceFloor: number,
): LeadVerdict {
  const a = response.answers;
  const mp = choiceOf(a.multiplayer_type, MULTIPLAYER_KEYS);
  const competitor = choiceOf(a.competitor, COMPETITOR_KEYS).key;
  const launch = scoreOf(a.launch_proximity);
  const serverPain = noulOf(a.server_pain);
  const funded = noulOf(a.funded_or_backed);
  const isStudio = noulOf(a.is_studio_signal);
  const excluded = noulOf(a.excluded);
  const reasons: string[] = [];

  const need = Math.min(1, NEED[mp.key] + (serverPain >= 0.5 ? 0.1 : 0));
  // qualify.py: need*70 + segment points + launch points.
  const launchPoints = launch >= 2 ? 10 : launch >= 1 ? 5 : 0;
  const tierA =
    (mp.key === "realtime_online" || serverPain >= 0.6) &&
    (funded >= 0.6 || serverPain >= 0.6);
  const fitScore = Math.round(
    Math.min(100, need * 70 + (tierA ? 20 : 8) + launchPoints),
  );

  let decision: LeadVerdict["decision"] = "keep";
  if (excluded >= 0.5) {
    decision = "drop";
    reasons.push(`exclusion applies (${excluded.toFixed(2)})`);
  }
  if (isStudio < 0.5) {
    decision = "drop";
    reasons.push(`not a studio signal (${isStudio.toFixed(2)})`);
  }
  if (mp.key === "local_or_single") {
    decision = "drop";
    reasons.push("nothing to host: local or single-player");
  }
  if (mp.key === "online_low_intensity") {
    decision = "drop";
    reasons.push("turn-based, card or async: dropped per runbook");
  }
  if (
    decision === "keep" &&
    (mp.key === "unclear" || mp.confidence < confidenceFloor)
  ) {
    decision = "needs_review";
    reasons.push(
      mp.key === "unclear"
        ? "multiplayer type unclear from the text"
        : `multiplayer type uncertain (${mp.confidence.toFixed(2)} < ${confidenceFloor})`,
    );
  }
  if (decision === "keep") {
    reasons.push(
      mp.key === "realtime_online"
        ? "real-time online multiplayer"
        : "small online co-op",
    );
    if (serverPain >= 0.5) reasons.push("explicit server language");
    if (funded >= 0.6) reasons.push("funded or publisher-backed");
    if (launch >= 2) reasons.push("launch, beta or playtest approaching");
  }

  const keep = decision === "keep";
  return {
    id: candidate.id,
    studio: candidate.studio,
    decision,
    tier: keep ? (tierA ? "A" : "B") : null,
    priority: keep
      ? need >= 0.7
        ? "High"
        : need >= 0.45
          ? "Medium"
          : "Low"
      : null,
    icpFit: keep
      ? fitScore >= 75
        ? "High"
        : fitScore >= 50
          ? "Medium"
          : "Low"
      : null,
    fitScore:
      keep || decision === "needs_review" ? fitScore : Math.min(fitScore, 20),
    multiplayerType: mp.key,
    multiplayerConfidence: mp.confidence,
    launchProximity: launch,
    serverPain,
    fundedOrBacked: funded,
    isStudioSignal: isStudio,
    excluded,
    competitor,
    currentInfra: INFRA[competitor],
    reasons,
    model: response.model,
  };
}

type QualifyOutcome =
  | { id: string; state: "evaluated"; verdict: LeadVerdict }
  | { id: string; state: "unavailable"; error: string };

export async function qualifyLeads(args: {
  candidates: LeadCandidate[];
  run: JevRunner;
  config?: Partial<QualifyConfig>;
}): Promise<{
  outcomes: QualifyOutcome[];
  inputTokens: number;
  elapsedMs: number;
}> {
  const config = { ...DEFAULT_QUALIFY_CONFIG, ...args.config };
  const started = Date.now();
  let inputTokens = 0;
  const outcomes: QualifyOutcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < args.candidates.length) {
      const index = next++;
      const candidate = args.candidates[index];
      try {
        const response = JevResponseSchema.parse(
          await withDeadline(
            args.run({
              state: {
                studio: candidate.studio,
                game: candidate.game ?? null,
                title: candidate.title ?? null,
                text: candidate.snippet,
                published: candidate.publishedDate ?? null,
                source: candidate.source ?? null,
                context:
                  "Gameye sells dedicated game-server hosting and orchestration. We are deciding whether this studio is a sales prospect.",
              },
              questions: QUESTIONS,
            }),
            config.deadlineMs,
          ),
        );
        inputTokens += response.usage.input_tokens;
        outcomes[index] = {
          id: candidate.id,
          state: "evaluated",
          verdict: composeVerdict(candidate, response, config.confidenceFloor),
        };
      } catch (error) {
        outcomes[index] = {
          id: candidate.id,
          state: "unavailable",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(config.concurrency, args.candidates.length) },
      worker,
    ),
  );
  return { outcomes, inputTokens, elapsedMs: Date.now() - started };
}
