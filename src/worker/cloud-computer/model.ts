import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { StepResultSchema } from "./protocol";
import { computerStub } from "./stub";

// Downy's transcript is the recovery checkpoint. The bridge produces one model
// step and yields tool intent; only Think executes tools, with existing gates.
// A fresh Codex thread per step also prevents a broader earlier tool grant from
// leaking into the restricted voice path.
const RETRY_DELAY_MS = 3000;

export function cloudComputerModel(
  env: Env,
  provider: "cloud-computer" | "boat-computer" = "cloud-computer",
): LanguageModelV3 {
  const modelId = env.DOWNY_CODEX_MODEL;
  async function generate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    options.abortSignal?.throwIfAborted();
    if (options.responseFormat?.type === "json")
      throw new Error(
        "Cloud computer does not support structured response formats yet.",
      );
    for (const message of options.prompt) {
      if (
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "file")
      )
        throw new Error(
          "Cloud computer currently accepts text and tool results only.",
        );
    }
    const tools = (options.tools ?? []).map((tool) => {
      if (tool.type !== "function")
        throw new Error("Unsupported cloud computer tool type.");
      return {
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
      };
    });
    const choice = options.toolChoice;
    if (choice?.type === "required" || choice?.type === "tool")
      throw new Error(
        "Forced tool choice is not supported by the cloud computer yet.",
      );
    const body = JSON.stringify({
      id: crypto.randomUUID(),
      model: modelId,
      system: options.prompt
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n"),
      transcript: JSON.stringify(
        options.prompt.filter((m) => m.role !== "system"),
      ),
      tools: choice?.type === "none" ? [] : tools,
    });
    const step = () =>
      computerStub(env, provider).fetch(
        new Request("https://computer.internal/step", {
          method: "POST",
          signal: options.abortSignal,
          body,
        }),
      );
    let response = await step();
    // A 503 is the container stopping mid-step, typically right after a
    // deploy replaced its image. The computer resets itself on that error,
    // so one retry after a pause runs on a fresh bridge. Still no fallback.
    if (response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      options.abortSignal?.throwIfAborted();
      response = await step();
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Reconnect ChatGPT in Settings → the selected computer card. Your work has been preserved."
          : response.status === 429
            ? "ChatGPT usage limit reached. No paid API fallback was used."
            : "Cloud computer could not complete this step. Check its status; no paid API fallback was used.",
      );
    options.abortSignal?.throwIfAborted();
    const result = StepResultSchema.parse(await response.json());
    return {
      content: [
        ...(result.text ? [{ type: "text" as const, text: result.text }] : []),
        ...result.toolCalls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.arguments,
        })),
      ],
      finishReason: {
        unified: result.toolCalls.length ? "tool-calls" : "stop",
        raw: undefined,
      },
      // Unknown usage is not reported as zero subscription consumption.
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
      warnings: [],
    };
  }
  return {
    specificationVersion: "v3",
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: generate,
    doStream: async (options) => {
      const result = await generate(options);
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({
              type: "stream-start",
              warnings: result.warnings,
            });
            for (const content of result.content) {
              if (content.type === "text") {
                controller.enqueue({ type: "text-start", id: "answer" });
                controller.enqueue({
                  type: "text-delta",
                  id: "answer",
                  delta: content.text,
                });
                controller.enqueue({ type: "text-end", id: "answer" });
              } else if (content.type === "tool-call")
                controller.enqueue(content);
            }
            controller.enqueue({
              type: "finish",
              finishReason: result.finishReason,
              usage: result.usage,
            });
            controller.close();
          },
        }),
      };
    },
  };
}
