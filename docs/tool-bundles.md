# Tool bundles, the compact voice prompt, and the voice model

Every turn used to hand the model the whole inventory: about thirty
parent-only tools, the shared file, skill and research tools, the connected
service wrappers and every MCP proxy, plus a system prompt that grew with each
feature. Most of the parent-only tools are lab features (Campaign Room,
Buildroom, local hands, the Grok shortcut). Voice paid for this twice: it got
the full chat prompt with a voice paragraph appended, and every read waited on
the same chat model.

## GTM bundle by default, lab on request

`src/worker/agent/tool-bundles.ts` names the lab tools. Unless an agent's
**Lab tools** setting is on (Settings → Lab tools, stored as
`agents.lab_tools_enabled`), those tools are hidden from the model and their
executors refuse with a fixed message, so a hallucinated call cannot run. The
tools stay registered; nothing else about them changes. Everything not listed
is the GTM bundle and is unaffected.

The bundle is applied before the channel policy, so a hidden lab tool is also
absent from voice even though three of them are on the voice allowlist.
Background workers are unchanged: they never had the parent-only lab tools,
apart from `request_local_hands_action`, which scheduled runs still use.

## Compact voice prompt

A voice turn now gets `buildVoiceSystemPrompt`: the voice rules, the four
identity files, the skills catalog, the Connections section, the active plan
and today's date. It drops the chat preamble, triage rules, the long tool
guide, peers and bootstrap. The voice rules are unchanged from the previous
inline addendum; they are just no longer appended to the full chat prompt.

## Voice model

Settings → Preferences has a **Voice model** selector. Unset means the chat
model, so nothing changes until the operator picks one. When set, voice turns
and the call's warm-up use that provider, and chat keeps its own. The model
status panel shows both providers.

## Measuring it

Each turn records what it handed the model: tool schemas defined, schemas
advertised, lab tools hidden, system prompt characters, advertised tool
description characters, and an estimated prompt token count (characters ÷ 4;
provider usage remains the billing truth). The latest measurement per channel
is kept in Durable Object storage, logged as `[agent] turn inventory`, and
shown in the model status panel as `chat · gtm 14/46 tools · 9.2k est.`.
Compare the numbers before and after toggling Lab tools or changing a prompt;
they are the evidence that a change helped.

## Not covered

- Per-intent bundles within GTM (research vs CRM vs outreach). The lab split
  removes most of the weight; finer bundles need a router and should wait
  for the measurement to say they are worth it.
- Child agents do not read the lab flag.
- A faster default voice model. The default stays "same as chat" so no call
  silently changes quality; pick Workers AI in Preferences for the fast path.
