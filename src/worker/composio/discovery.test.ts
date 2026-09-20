import { expect, it, vi } from "vitest";
import { findToolSetup } from "./discovery";
// eslint-disable-next-line typescript/no-unsafe-type-assertion -- known paths need no secret bindings.
const env = {} as Cloudflare.Env;
it("Airtable discovery works with neither project API key nor Exa", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unavailable"));
  try {
    const result = await findToolSetup(env, "Can you connect to Airtable?");
    expect(result).toMatchObject({
      candidates: [{ toolkit: "airtable", confidence: "confirmed" }],
      warnings: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
it("other service discovery uses the signed-in catalog before API-key or web fallbacks", async () => {
  const discover = vi.fn(async () => [
    {
      name: "Slack",
      toolkit: "slack",
      path: "composio" as const,
      confidence: "confirmed" as const,
    },
  ]);
  const result = await findToolSetup(env, "Slack", discover);
  expect(discover).toHaveBeenCalledWith("Slack");
  expect(result.candidates[0]).toMatchObject({ toolkit: "slack" });
  expect(result.warnings).toEqual([]);
});
