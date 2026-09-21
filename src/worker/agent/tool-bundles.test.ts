import { tool } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { bundleToolSet, LAB_TOOL_NAMES, withoutHidden } from "./tool-bundles";
import { measureTurnInventory } from "./turn-inventory";

function fixture(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        description: `${name} does things`,
        inputSchema: z.object({}),
        execute: async () => `${name} ran`,
      }),
    ]),
  );
}

const INVENTORY = [
  "web_search",
  "stage_action",
  "qualify_leads",
  "airtable_records",
  "tool_treg_call",
  "create_buildroom_job",
  "advance_buildroom_workflow",
  "request_local_hands_action",
  "request_grok_research",
  "read_campaign_artifact",
];

it("hides and blocks lab tools by default while leaving the GTM bundle untouched", async () => {
  const { tools, hidden } = bundleToolSet(fixture(INVENTORY), false);
  expect(hidden).toEqual([
    "create_buildroom_job",
    "advance_buildroom_workflow",
    "request_local_hands_action",
    "request_grok_research",
    "read_campaign_artifact",
  ]);
  for (const name of hidden) {
    expect(tools[name]).toBeDefined();
    await expect(
      tools[name].execute?.({}, { toolCallId: name, messages: [] }),
    ).rejects.toThrow("turned off for this agent");
  }
  expect(
    await tools.qualify_leads.execute?.({}, { toolCallId: "q", messages: [] }),
  ).toBe("qualify_leads ran");
  expect(withoutHidden(INVENTORY, hidden)).toEqual([
    "web_search",
    "stage_action",
    "qualify_leads",
    "airtable_records",
    "tool_treg_call",
  ]);
  expect(withoutHidden(INVENTORY, [])).toBe(INVENTORY);
});

it("returns the full inventory when lab tools are enabled", async () => {
  const { tools, hidden } = bundleToolSet(fixture(INVENTORY), true);
  expect(hidden).toEqual([]);
  expect(
    await tools.create_buildroom_job.execute?.(
      {},
      { toolCallId: "b", messages: [] },
    ),
  ).toBe("create_buildroom_job ran");
  // Every lab name is a real parent tool; a typo here would silently expose it.
  for (const name of LAB_TOOL_NAMES) expect(name).toMatch(/^[a-z_]+$/);
});

it("measures what a turn hands the model, counting only advertised schemas", () => {
  const tools = fixture(INVENTORY);
  const { hidden } = bundleToolSet(tools, false);
  const active = withoutHidden(INVENTORY, hidden);
  const inventory = measureTurnInventory({
    channel: "chat",
    bundle: "gtm",
    system: "x".repeat(4000),
    tools,
    activeTools: active,
    hidden,
    now: 5,
  });
  expect(inventory).toMatchObject({
    channel: "chat",
    bundle: "gtm",
    toolDefinitions: 10,
    activeTools: 5,
    hiddenTools: 5,
    systemChars: 4000,
    recordedAt: 5,
  });
  const descriptionChars = active.reduce(
    (sum, name) => sum + `${name} does things`.length,
    0,
  );
  expect(inventory.toolDescriptionChars).toBe(descriptionChars);
  expect(inventory.estimatedPromptTokens).toBe(
    Math.round((4000 + descriptionChars) / 4),
  );
});
