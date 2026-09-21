import { VOICE_MAX_MS } from "../../lib/voice";

const MIN_MINUTES = 5;
const MAX_MINUTES = 120;

/**
 * Maximum call length from the operator's deployment, clamped so a typo
 * cannot create an unbounded paid session. Default is the previous fixed
 * fifteen minutes.
 */
export function voiceMaxMs(
  env: Pick<Cloudflare.Env, "DOWNY_VOICE_MAX_MINUTES">,
): number {
  const minutes = Number(env.DOWNY_VOICE_MAX_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) return VOICE_MAX_MS;
  return (
    Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes))) * 60_000
  );
}
