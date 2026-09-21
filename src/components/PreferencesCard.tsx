import {
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "../lib/ai-providers";
import {
  useAiProvider,
  useShowThinking,
  useVoiceAiProvider,
  VOICE_PROVIDER_SAME_AS_CHAT,
} from "../lib/preferences";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  "cloud-computer": "Cloudflare computer (ChatGPT subscription)",
  "boat-computer": "Boat pilot (ChatGPT subscription)",
  kimi: "Kimi K2.6 (Workers AI)",
  "pi-local": "Pi proxy (local)",
  "pi-prod": "Pi proxy (prod)",
  openrouter: "OpenRouter",
};

export default function PreferencesCard() {
  const [showThinking, setShowThinking] = useShowThinking();
  const [aiProvider, setAiProvider] = useAiProvider();
  const [voiceProvider, setVoiceProvider] = useVoiceAiProvider();

  return (
    <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="text-base font-semibold">Preferences</h2>

        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Show thinking</span>
            <span className="mt-1 block text-xs text-base-content/70">
              Expand reasoning blocks by default.
            </span>
          </span>
          <input
            type="checkbox"
            className="toggle toggle-primary flex-shrink-0"
            checked={showThinking}
            onChange={(e) => {
              setShowThinking(e.target.checked);
            }}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="block text-sm font-medium">Model</span>
          <select
            className="select select-bordered select-sm"
            value={aiProvider}
            onChange={(e) => {
              const next = e.target.value;
              if (isAiProvider(next)) setAiProvider(next);
            }}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="block text-sm font-medium">Voice model</span>
          <span className="block text-xs text-base-content/70">
            Model for lookups during a call. Pick a fast one so a call never
            waits on a slower chat provider.
          </span>
          <select
            className="select select-bordered select-sm"
            value={voiceProvider}
            onChange={(e) => {
              const next = e.target.value;
              if (next === VOICE_PROVIDER_SAME_AS_CHAT || isAiProvider(next))
                setVoiceProvider(next);
            }}
          >
            <option value={VOICE_PROVIDER_SAME_AS_CHAT}>Same as chat</option>
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
