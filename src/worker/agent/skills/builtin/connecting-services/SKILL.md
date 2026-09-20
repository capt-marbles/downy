---
name: connecting-services
description: Connects or repairs an app integration using verified setup checkpoints and secure authorization cards. Use for requests to connect services or resume an interrupted connection.
---

Call find_tool_setup with the service name. It first checks existing authorization, then discovers Composio, documented MCP options, and vendor documentation. Its runbook checkpoint survives interruptions.

Follow the returned nextAction. A discovery failure means the lookup was unavailable, not that a connector does not exist. Request an official documentation link or clarify the service if needed. Do not invent endpoints. Use retry:true only when the user asks to retry discovery; attempts are bounded.

For Gmail and Airtable, show the managed card and stop while authorization is pending. Never request credentials in chat or search workspace files for them. An empty MCP list says nothing about managed OAuth.

After the user completes authorization, call list_mcp_servers to resume pending checks, or find_tool_setup with the same service. A verified checkpoint means account identity and a minimal read were checked. Report the supported operations and channels exactly; connection does not imply every operation is enabled. Generic MCP discovery is only a candidate until its connection and intended operation are verified. Ask what operation is needed before granting broader tools.

If verification fails, explain the bounded failure and use the existing card. Do not restart OAuth automatically or claim success from prose. Voice may inspect status but must direct connection changes to chat controls.
