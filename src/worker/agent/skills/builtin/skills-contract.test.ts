import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseSkillFile } from "../frontmatter";

// Bundled skills may only name tools that exist. A typo here would send the
// model after a tool it cannot call, and nothing else would catch it.
const KNOWN_TOOLS = new Set([
  "web_search",
  "web_scrape",
  "read",
  "write",
  "list",
  "find",
  "grep",
  "read_skill",
  "list_skills",
  "airtable_records",
  "gmail_email",
  "slack_channels",
  "qualify_leads",
  "check_outreach_draft",
  "stage_action",
  "list_staged_actions",
  "schedule_task",
  "list_scheduled_tasks",
  "spawn_background_task",
  "find_tool_setup",
  "connect_mcp_server",
  "list_mcp_servers",
  "tool_treg_call",
  "tool_treg_catalog_search",
  "tool_treg_catalog_get",
  "tool_treg_balance",
]);
// Actions of the connected-service tools, named in backticks like tools.
const KNOWN_ACTIONS = new Set([
  "list_bases",
  "get_schema",
  "list_records",
  "pipeline_report",
  "create_draft",
  "list_channels",
]);
const KNOWN_KINDS = new Set([
  "gmail_draft",
  "schedule_task",
  "airtable_create_records",
  "airtable_update_records",
  "slack_post_message",
]);

function skill(name: string) {
  const content = readFileSync(
    `src/worker/agent/skills/builtin/${name}/SKILL.md`,
    "utf8",
  );
  const parsed = parseSkillFile(content);
  if (!parsed.ok) throw new Error(parsed.error);
  return { content, frontmatter: parsed.parsed.frontmatter };
}

it("outreach skill names only real tools and staged kinds, and never sends", () => {
  const { content, frontmatter } = skill("gameye-outreach");
  expect(frontmatter.name).toBe("gameye-outreach");
  for (const match of content.matchAll(/`([a-z_]+(?:_[a-z_]+)+)`/g)) {
    const name = match[1];
    if (
      name.startsWith("tool_") ||
      KNOWN_TOOLS.has(name) ||
      KNOWN_KINDS.has(name) ||
      KNOWN_ACTIONS.has(name)
    )
      continue;
    if (/^fld|^tbl|^app|^rec/.test(name)) continue;
    throw new Error(`unknown tool or kind named in gameye-outreach: ${name}`);
  }
  for (const required of [
    "airtable_update_records",
    "slack_post_message",
    "create_draft",
    "in:sent",
    "never sends",
    "fld0LF1jhcZlUuwTT",
    "fldXsrMfFJow78AsN",
    "flds3DTpqS7AZ878k",
    "appZgInlaiE12FCu7",
    "tblXVK9F4tZfvy4jj",
  ])
    expect(content).toContain(required);
  // The skill must not teach the model to send or DM.
  expect(content).not.toMatch(
    /\bsend_message\b|SlackOpenDM|GMAIL_SEND|gmail_send/,
  );
  expect(content).not.toMatch(/—/);
});

it("lead sourcing hands off to the outreach runbook", () => {
  expect(skill("gameye-lead-sourcing").content).toContain("gameye-outreach");
});
