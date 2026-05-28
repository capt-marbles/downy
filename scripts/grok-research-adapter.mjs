#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const providerCommand = process.env.DOWNY_GROK_ADAPTER_CMD;
const providerTimeoutMs = Number(
  process.env.DOWNY_GROK_ADAPTER_TIMEOUT_MS ?? "300000",
);
const fixtureMode = process.env.DOWNY_GROK_ADAPTER_FIXTURE === "1";

function parseMaybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readRequest() {
  const raw = process.env.DOWNY_GROK_RESEARCH_JSON;
  const parsed = raw ? parseMaybeJson(raw) : null;
  return {
    query:
      typeof parsed?.query === "string"
        ? parsed.query
        : (process.env.DOWNY_GROK_RESEARCH_QUERY ?? ""),
    mode:
      typeof parsed?.mode === "string"
        ? parsed.mode
        : (process.env.DOWNY_GROK_RESEARCH_MODE ?? "research_summary"),
    maxResults:
      typeof parsed?.maxResults === "number"
        ? parsed.maxResults
        : Number(process.env.DOWNY_GROK_RESEARCH_MAX_RESULTS ?? "20"),
    outputArtifact:
      typeof parsed?.outputArtifact === "string"
        ? parsed.outputArtifact
        : (process.env.DOWNY_GROK_RESEARCH_OUTPUT_ARTIFACT ??
          "campaign-source-notes"),
    context: parsed?.context ?? process.env.DOWNY_GROK_RESEARCH_CONTEXT ?? null,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function sourceFromUrl(url) {
  return {
    url,
    title: url,
    source_type:
      url.includes("x.com") || url.includes("twitter.com") ? "x" : "web",
    captured_at: new Date().toISOString(),
    confidence: "medium",
  };
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s)\]}>,"']+/g) ?? [];
  return [...new Set(matches)].slice(0, 50).map(sourceFromUrl);
}

function normalizeSource(value) {
  if (typeof value === "string") return sourceFromUrl(value);
  if (!value || typeof value !== "object") return null;
  const url = typeof value.url === "string" ? value.url : undefined;
  return {
    ...(url ? { url } : {}),
    title:
      typeof value.title === "string"
        ? value.title
        : typeof value.name === "string"
          ? value.name
          : url,
    source_type:
      typeof value.source_type === "string"
        ? value.source_type
        : typeof value.sourceType === "string"
          ? value.sourceType
          : url?.includes("x.com") || url?.includes("twitter.com")
            ? "x"
            : "web",
    captured_at:
      typeof value.captured_at === "string"
        ? value.captured_at
        : new Date().toISOString(),
    confidence:
      value.confidence === "low" ||
      value.confidence === "medium" ||
      value.confidence === "high"
        ? value.confidence
        : "medium",
    notes: typeof value.notes === "string" ? value.notes : undefined,
  };
}

function normalizeResearch(raw, request, stderr = "") {
  const parsed = typeof raw === "string" ? parseMaybeJson(raw.trim()) : raw;
  if (parsed && typeof parsed === "object") {
    const summary =
      typeof parsed.summary === "string"
        ? parsed.summary
        : typeof parsed.answer === "string"
          ? parsed.answer
          : typeof parsed.text === "string"
            ? parsed.text
            : `Research completed for: ${request.query}`;
    const sourceValues = Array.isArray(parsed.sources) ? parsed.sources : [];
    return {
      summary,
      sources: sourceValues.map(normalizeSource).filter(Boolean),
      claims: asArray(parsed.claims),
      opportunities: asArray(parsed.opportunities),
      open_questions: asArray(parsed.open_questions ?? parsed.openQuestions),
      research_limits:
        typeof parsed.research_limits === "string"
          ? parsed.research_limits
          : typeof parsed.researchLimits === "string"
            ? parsed.researchLimits
            : `Provider command: ${providerCommand ?? "fixture"}. Mode: ${request.mode}. Max results: ${String(request.maxResults)}.${stderr ? ` stderr: ${stderr.slice(-1000)}` : ""}`,
    };
  }
  const text = String(raw ?? "").trim();
  return {
    summary: text || `Research adapter produced no text for: ${request.query}`,
    sources: extractUrls(text),
    claims: [],
    opportunities: [],
    open_questions: [],
    research_limits: `Provider output was plain text. Mode: ${request.mode}. Max results: ${String(request.maxResults)}.${stderr ? ` stderr: ${stderr.slice(-1000)}` : ""}`,
  };
}

async function runProvider(request) {
  if (fixtureMode) {
    return normalizeResearch(
      {
        summary: `Fixture Grok/X research for: ${request.query}`,
        sources: [
          {
            url: "https://x.com/example/status/1",
            title: "Fixture X source",
            source_type: "x",
            confidence: "low",
            notes: "Fixture output for adapter smoke testing.",
          },
        ],
        claims: ["Fixture claim, replace with authenticated Grok/X output."],
        opportunities: ["Fixture opportunity for Campaign Room smoke testing."],
        open_questions: ["Configure DOWNY_GROK_ADAPTER_CMD for real research."],
        research_limits:
          "Fixture mode. No live X or Grok search was performed.",
      },
      request,
    );
  }
  if (!providerCommand) {
    throw new Error(
      "Set DOWNY_GROK_ADAPTER_CMD to a local Grok/X/Xurl command, or DOWNY_GROK_ADAPTER_FIXTURE=1 for a dry smoke.",
    );
  }
  const { stdout, stderr } = await execFileAsync(providerCommand, [], {
    timeout: providerTimeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      DOWNY_GROK_RESEARCH_JSON: JSON.stringify(request),
      DOWNY_GROK_RESEARCH_QUERY: request.query,
      DOWNY_GROK_RESEARCH_MODE: request.mode,
      DOWNY_GROK_RESEARCH_MAX_RESULTS: String(request.maxResults),
      DOWNY_GROK_RESEARCH_OUTPUT_ARTIFACT: request.outputArtifact,
      DOWNY_GROK_RESEARCH_CONTEXT:
        typeof request.context === "string"
          ? request.context
          : JSON.stringify(request.context ?? null),
    },
  });
  return normalizeResearch(stdout, request, stderr);
}

const request = readRequest();
if (!request.query.trim()) {
  throw new Error("DOWNY_GROK_RESEARCH_QUERY is required");
}
const research = await runProvider(request);
process.stdout.write(`${JSON.stringify(research, null, 2)}\n`);
