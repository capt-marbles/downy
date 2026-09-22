import { Mic, MicOff, Phone, PhoneOff, RotateCcw, Volume2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { agentFetch } from "../../lib/agent-request";
import { VoiceClient, type CallView } from "../../lib/voice-client";
import StatusDot from "../ui/StatusDot";

const VoiceConfigSchema = z.object({ maxMinutes: z.number() });

export default function VoiceCallPanel({
  slug,
  disabled,
  onActiveChange,
}: {
  slug: string;
  disabled?: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const client = useRef<VoiceClient | null>(null);
  const [view, setView] = useState<CallView>({
    state: "idle",
    muted: false,
    working: false,
    needsPlayback: false,
    startedAt: null,
    captions: [],
    error: null,
    maxMinutes: null,
    canReconnect: false,
    paused: false,
  });
  const [now, setNow] = useState(Date.now());
  const config = useQuery({
    queryKey: ["voice-config", slug],
    queryFn: async () => {
      const response = await agentFetch(slug, "/api/voice");
      if (!response.ok) return null;
      const parsed = VoiceConfigSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    },
    staleTime: 5 * 60_000,
  });
  const maxMinutes = view.maxMinutes ?? config.data?.maxMinutes ?? null;
  const active = ["connecting", "live", "ending"].includes(view.state);

  useEffect(() => {
    if (!audio.current) return undefined;
    const current = new VoiceClient(slug, audio.current, setView);
    client.current = current;
    return () => {
      current.dispose();
      client.current = null;
    };
  }, [slug]);
  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const seconds = view.startedAt
    ? Math.max(0, Math.floor((now - view.startedAt) / 1000))
    : 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${maxMinutes ? ` / ${maxMinutes}:00` : ""}`;
  return (
    <section
      aria-label="Voice call"
      className={`mb-2 ${active ? "rounded-box border border-primary/30 bg-base-100 p-3" : ""}`}
    >
      <audio ref={audio} autoPlay playsInline />
      <div className="flex items-center gap-2">
        {active ? (
          <>
            <StatusDot
              tone={view.state === "live" ? "success" : "warning"}
              pulse={view.state === "connecting"}
            />
            <span className="flex-1 text-sm" role="status">
              {view.state === "connecting"
                ? "Connecting call…"
                : view.state === "ending"
                  ? "Ending call…"
                  : view.paused
                    ? "Paused while in the background"
                    : view.muted
                      ? "Microphone muted"
                      : view.working
                        ? "Downy is looking that up · keep talking"
                        : "Call connected · listening"}{" "}
              <span className="text-base-content/50">{clock}</span>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle"
              disabled={view.state !== "live"}
              onClick={() => client.current?.mute()}
              aria-label={view.muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={view.muted}
            >
              {view.muted ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
            <button
              type="button"
              className="btn btn-error btn-sm"
              disabled={view.state === "ending"}
              onClick={() => void client.current?.end()}
            >
              <PhoneOff size={17} /> End call
            </button>
          </>
        ) : (
          <>
            {view.state === "ended" && view.canReconnect ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={disabled}
                onClick={() => void client.current?.start()}
              >
                <RotateCcw size={16} /> Reconnect
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => void client.current?.start()}
              >
                <Phone size={16} /> Start a call
              </button>
            )}
            <span className="text-xs text-base-content/50">
              {view.state === "ended" && view.canReconnect
                ? "Starts a new call; work from the last one carries over."
                : `Voice · research, drafts & proposals${maxMinutes ? ` · ${maxMinutes} min limit` : ""}`}
            </span>
          </>
        )}
      </div>
      {active ? (
        <p className="mt-1 text-xs text-base-content/50">
          OpenAI voice · captions saved in chat, no Downy audio recordings.
          Switching apps pauses the call for up to three minutes; come back to
          resume. Changes and approvals stay in chat.
        </p>
      ) : null}
      {view.needsPlayback && active ? (
        <button
          type="button"
          className="btn btn-warning btn-sm mt-2"
          onClick={() => void client.current?.play()}
        >
          <Volume2 size={16} /> Enable sound
        </button>
      ) : null}
      {view.error ? (
        <p className="mt-2 text-sm text-warning" role="alert">
          {view.error}
        </p>
      ) : null}
      {view.captions.length ? (
        <div
          className="mt-2 max-h-32 overflow-auto text-sm"
          aria-label={
            active
              ? "Live captions (approximate)"
              : "Call captions (approximate)"
          }
        >
          {!active && (
            <p className="text-xs text-base-content/50">
              Call ended · approximate captions
            </p>
          )}
          {(active ? view.captions.slice(-3) : view.captions).map(
            (caption, index) => (
              <p key={`${caption.startMs}-${index}`} className="mt-1">
                <span className="text-base-content/50">
                  {caption.role === "user" ? "You" : "Downy"}:{" "}
                </span>
                {caption.text}
              </p>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}
