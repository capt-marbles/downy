import ComparisonPanel from "./ComparisonPanel";
import { createContext, useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { Check, Clock3, ListChecks } from "lucide-react";
import { z } from "zod";
import { agentFetch } from "../../lib/agent-request";
import { useCurrentAgentSlug } from "../../lib/agents";
import {
  PILOT_OPTIONS,
  PilotChoiceSchema,
  PilotSourceUrlsSchema,
  pilotCatalog,
  type PilotChoice,
  type PilotOptionId,
} from "../../lib/pilot-choices";
const ReplySchema = z.object({
  choice: PilotChoiceSchema.nullable(),
  error: z.string().nullable().optional(),
});
const ChoiceContext = createContext<{
  choice: PilotChoice;
  busy: boolean;
  choose: (id: PilotOptionId) => void;
} | null>(null);

const { registry } = defineRegistry(pilotCatalog, {
  components: {
    Choices: ({ props, children }) => (
      <div
        className={
          props.layout === "grid"
            ? "grid min-w-0 gap-3 lg:grid-cols-3"
            : "grid min-w-0 gap-3"
        }
      >
        {children}
      </div>
    ),
    PilotOption: ({ props }) => {
      const context = useContext(ChoiceContext);
      const option = PILOT_OPTIONS.find((item) => item.id === props.optionId);
      if (!context || !option) return null;
      const selected = context.choice.selectedId === option.id;
      const expired = context.choice.expiresAt <= Date.now();
      return (
        <article
          data-pilot-card={option.id}
          className={`flex min-w-0 flex-col rounded-xl border p-4 ${selected ? "border-primary bg-primary/5" : "border-base-300 bg-base-100"}`}
        >
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-base-content/55">
            <Clock3 size={13} />
            {option.effort} after setup
          </p>
          <h3 className="text-base font-semibold">{option.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-base-content/70">
            {option.summary}
          </p>
          <details className="mt-3 text-xs leading-relaxed text-base-content/60">
            <summary className="min-h-8 cursor-pointer py-1">
              Prerequisites & success criteria
            </summary>
            <p className="mt-1">
              <strong>Needs:</strong> {option.needs}
            </p>
            <p className="mt-2">
              <strong>Success:</strong> {option.success}
            </p>
          </details>
          <button
            type="button"
            className={`btn btn-sm mt-auto min-h-11 w-full gap-2 ${selected ? "btn-primary" : "btn-outline"}`}
            disabled={context.busy || !!context.choice.selectedId || expired}
            onClick={() => context.choose(option.id)}
          >
            {selected ? (
              <>
                <Check size={15} />
                Selected
              </>
            ) : expired ? (
              "Expired"
            ) : (
              "Choose this pilot"
            )}
          </button>
        </article>
      );
    },
  },
});

export default function PilotChoices({ ticketId }: { ticketId: string }) {
  const slug = useCurrentAgentSlug();
  const client = useQueryClient();
  const queryKey = ["pilot-choice", slug, ticketId];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await agentFetch(
        slug,
        `/api/pilot-choices?ticket=${encodeURIComponent(ticketId)}`,
      );
      if (!response.ok)
        throw new Error(
          "These options could not be loaded. Request fresh CUA pilot options below.",
        );
      return ReplySchema.parse(await response.json()).choice;
    },
    refetchInterval: (state) =>
      !state.state.data ||
      (!state.state.data.selectedId && state.state.data.expiresAt <= Date.now())
        ? false
        : state.state.data.selectedId
          ? 15000
          : 5000,
  });
  const selection = useMutation({
    mutationFn: async (id: PilotOptionId) => {
      const response = await agentFetch(
        slug,
        `/api/pilot-choices?ticket=${encodeURIComponent(ticketId)}&option=${id}`,
        { method: "POST" },
      );
      const result = ReplySchema.safeParse(await response.json());
      if (result.success && result.data.choice)
        client.setQueryData(queryKey, result.data.choice);
      if (!response.ok || !result.success || result.data.error)
        throw new Error(
          result.success
            ? result.data.error || "Could not save your selection. Try again."
            : "Could not save your selection. Try again.",
        );
    },
  });
  const choice = query.data;
  const error = selection.error || query.error;
  if (!choice)
    return (
      <p role="status" className="my-3 text-sm text-base-content/60">
        {error?.message || "Loading CUA pilot options…"}
      </p>
    );
  return (
    <section
      id={`pilot-choice-${ticketId}`}
      data-kind="pilot-choice"
      className="my-4 rounded-xl border border-base-300 bg-base-200/30 p-3 sm:p-4"
    >
      <div className="mb-4">
        <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
          <ListChecks size={14} />
          Your next CUA pilot
        </p>
        <h2 className="text-lg font-semibold">Which would you like to try?</h2>
        <p className="mt-1 text-xs leading-relaxed text-base-content/60">
          Choose a direction. Your preference is saved in chat; starting the
          work is a separate step.
        </p>
      </div>
      <ChoiceContext.Provider
        value={{
          choice,
          busy: selection.isPending,
          choose: (id) => selection.mutate(id),
        }}
      >
        <JSONUIProvider registry={registry}>
          <Renderer spec={choice.spec} registry={registry} />
        </JSONUIProvider>
      </ChoiceContext.Provider>
      {choice.selectedId === "source-comparison" && (
        <PilotSources
          key={choice.sources?.revision || "new"}
          choice={choice}
          slug={slug}
        />
      )}
      {choice.selectedId === "source-comparison" && choice.sources && (
        <ComparisonPanel
          ticketId={choice.id}
          sourceRevision={choice.sources.revision}
        />
      )}
      <div
        aria-live="polite"
        className="mt-3 text-xs leading-relaxed text-base-content/60"
      >
        {selection.isPending && <p>Saving your choice…</p>}
        {error && (
          <p role="alert" className="text-error">
            {error.message}
          </p>
        )}
        {choice.selectedId ? (
          <p>
            {choice.selectedId === "source-comparison" && choice.sources
              ? "Preference saved. Comparison progress appears above."
              : "Preference saved. No task has started."}
          </p>
        ) : choice.expiresAt <= Date.now() ? (
          <p>These options expired. Request fresh options to choose.</p>
        ) : (
          <p>Run estimates exclude CUA installation and test setup.</p>
        )}
      </div>
      <details className="mt-2 text-[11px] text-base-content/45">
        <summary className="cursor-pointer py-2">About these choices</summary>
        {choice.composition.state === "jev"
          ? `Arranged by Jev on Cloudflare · ${choice.composition.models.join(", ")} · ${choice.composition.calls} evaluations · ${(choice.composition.elapsedMs / 1000).toFixed(1)}s.`
          : "Jev could not finish the layout. All three options are shown in a standard list."}{" "}
        The pilot descriptions are prepared by Downy; Jev only arranges them.
        Your choice expires after 24 hours if unanswered.
      </details>
    </section>
  );
}

function PilotSources({ choice, slug }: { choice: PilotChoice; slug: string }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (urls: string[]) => {
      const checked = PilotSourceUrlsSchema.safeParse(urls);
      if (!checked.success)
        throw new Error(
          "Add three different web URLs without embedded credentials.",
        );
      const response = await agentFetch(
        slug,
        `/api/pilot-choices?ticket=${choice.id}&sources=1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: checked.data }),
        },
      );
      const result = ReplySchema.safeParse(await response.json());
      if (
        !response.ok ||
        !result.success ||
        result.data.error ||
        !result.data.choice
      )
        throw new Error(
          result.success
            ? result.data.error || "Could not save sources. Try again."
            : "Could not save sources. Try again.",
        );
      client.setQueryData(
        ["pilot-choice", slug, choice.id],
        result.data.choice,
      );
    },
  });
  return (
    <form
      className="mt-4 rounded-lg border border-base-300 bg-base-100 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        save.mutate(
          [1, 2, 3].map((i) => {
            const value = data.get(`source${i}`);
            return typeof value === "string" ? value.trim() : "";
          }),
        );
      }}
    >
      <fieldset disabled={save.isPending} className="grid min-w-0 gap-3">
        <legend className="mb-2 text-sm font-semibold">
          Three source URLs
        </legend>
        <p className="text-xs text-base-content/65">
          Paste one public page per field. Saving prepares the brief; it doesn’t
          start research.
        </p>
        {[1, 2, 3].map((i) => (
          <label key={i} className="grid min-w-0 gap-1 text-xs">
            Source {i}
            <input
              name={`source${i}`}
              type="url"
              inputMode="url"
              required
              maxLength={2048}
              defaultValue={choice.sources?.urls[i - 1] || ""}
              placeholder="https://…"
              className="input input-bordered min-h-11 w-full min-w-0 text-sm"
            />
          </label>
        ))}
        <button type="submit" className="btn btn-primary btn-sm min-h-11">
          {save.isPending
            ? "Saving sources…"
            : choice.sources
              ? "Update sources"
              : "Save sources"}
        </button>
      </fieldset>
      <div aria-live="polite" className="mt-2 text-xs text-base-content/65">
        {save.error && (
          <p role="alert" className="text-error">
            {save.error.message}
          </p>
        )}
        {choice.sources && (
          <p>
            Three URLs saved. Use the comparison panel below to start research
            or view its progress.
          </p>
        )}
      </div>
    </form>
  );
}
