import { agentFetch } from "../../lib/agent-request";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
const Config = z.object({
  enabled: z.boolean(),
  passThreshold: z.number(),
  confidenceFloor: z.number(),
  disabledTemplates: z.array(z.string()),
});
export default function CriteriaSettings({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["criteria-config", slug],
    queryFn: async () => {
      const response = await agentFetch(
        slug,
        "/api/campaign-room/criteria-config",
      );
      return Config.parse(await response.json());
    },
  });
  return (
    <section className="my-6 border-t border-base-300 py-4 text-sm">
      <h2 className="font-semibold">Campaign criteria</h2>
      {data && (
        <>
          <p>
            Jev checks: {data.enabled ? "enabled" : "disabled"} · Pass
            threshold: {data.passThreshold} · Certainty floor:{" "}
            {data.confidenceFloor}
          </p>
          <p>
            Template opt-outs: {data.disabledTemplates.join(", ") || "none"}
          </p>
          <p className="text-xs text-base-content/60">
            Configured by the operator. Machine evidence cannot replace gate
            approval.
          </p>
        </>
      )}
      {error && <p role="alert">Could not load criteria settings.</p>}
    </section>
  );
}
