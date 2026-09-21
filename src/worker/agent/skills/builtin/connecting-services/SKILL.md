---
name: connecting-services
description: Connects an app integration through the flow Downy has for that service (Gmail and Airtable cards, Treg as an MCP server) and says plainly when a service cannot be connected yet. Use for requests to connect, reconnect or check a service.
---

Read this skill once per conversation; if its instructions are already in context, follow them without reading again.

Call find_tool_setup with the service name once. Follow the returned nextAction exactly; it is code-owned truth about what this bot can do. Do not call find_tool_setup again for the same service in the same conversation unless the user completed an authorization step or asked to retry.

Per service:

- Gmail and Airtable: Composio owns the OAuth. find_tool_setup shows the secure card and ends the turn. The user authorizes on the card; never ask for keys or credentials in chat and never search workspace files for them. After they finish, call list_mcp_servers or find_tool_setup again to verify identity and a minimal read. Gmail gives search, read and create_draft. Airtable gives reads and pipeline reports; new records go through a stage_action card of kind airtable_create_records.
- Treg: an MCP server. nextAction gives the exact connect_mcp_server call; authorization happens in the browser. After it connects, run one minimal read before claiming access. Its calls spend a prepaid balance and never post.
- Slack: not connectable yet. Say so in one sentence and offer the chat summary instead. Do not offer Slack or Slackbot as choices.
- TaskFuel: CLI-only, no MCP; cannot be connected from Downy.
- Any other service: find_tool_setup may return documentation candidates. Tell the user plainly that it cannot be connected from chat today and which services can. Do not ask them to choose a candidate.

Scheduled or unattended posting and writing to connected services is not available yet; say so and offer the chat-driven version. Voice may inspect status but directs connection changes to chat controls. A verified checkpoint means identity plus a minimal read; connection does not imply every operation is enabled.
