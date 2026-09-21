import { expect, it } from "vitest";
import {
  connectedServiceToolNames,
  isVoiceTool,
  readOrientedToolNames,
  serviceChannels,
  TREG_VOICE_ENDPOINTS,
} from "./tool-channels";

it("derives the voice allowlist, including only the named Treg proxy tools", () => {
  for (const name of [
    "web_search",
    "airtable_records",
    "slack_channels",
    "gmail_email",
    "qualify_leads",
    "stage_action",
    "tool_treg_call",
    "tool_treg_catalog_search",
    "tool_treg_balance",
  ])
    expect(isVoiceTool(name), name).toBe(true);
  for (const name of [
    "write",
    "schedule_task",
    "connect_mcp_server",
    "request_credential",
    "tool_treg_my_tools",
    "tool_treg_review",
    "tool_github_call",
    "tool_treg",
    "new_tool",
  ])
    expect(isVoiceTool(name), name).toBe(false);
  expect(TREG_VOICE_ENDPOINTS.has("treg.people.search")).toBe(true);
});

it("keeps the effect gate's name sets in step with the channel table", () => {
  expect(readOrientedToolNames()).toEqual(
    new Set([
      "find",
      "grep",
      "list",
      "list_skill_files",
      "list_skills",
      "read",
      "read_peer_agent",
      "read_skill",
      "web_scrape",
      "web_search",
    ]),
  );
  expect(connectedServiceToolNames()).toEqual(
    new Set(["airtable_records", "gmail_email", "slack_channels"]),
  );
});

it("reports a service as voice-capable only when one of its tools is", () => {
  expect(serviceChannels("gmail")).toEqual(["chat", "voice"]);
  expect(serviceChannels("airtable")).toEqual(["chat", "voice"]);
  expect(serviceChannels("slack")).toEqual(["chat", "voice"]);
  expect(serviceChannels("treg")).toEqual(["chat", "voice"]);
  expect(serviceChannels("sentry")).toEqual(["chat"]);
});
