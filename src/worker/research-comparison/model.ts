/** Kimi's reasoning can consume the entire bounded draft budget before JSON.
 * Scope this binding wrapper to comparison drafts, never normal chat or Jev.
 * https://developers.cloudflare.com/changelog/post/2026-04-20-kimi-k2-6-workers-ai/
 */
export function comparisonAiBinding(ai: Ai): Ai {
  // Proxy preserves all Ai.run overloads (batch/raw/synchronous), forwarding
  // their result unchanged. Only this model's JSON input is adjusted.
  const run = new Proxy(ai.run.bind(ai), {
    apply(target, _receiver, args: unknown[]): unknown {
      const [model, input, ...options] = args;
      const adjusted =
        model === "@cf/moonshotai/kimi-k2.6" &&
        typeof input === "object" &&
        input !== null
          ? { ...input, chat_template_kwargs: { thinking: false } }
          : input;
      return Reflect.apply(target, ai, [model, adjusted, ...options]);
    },
  });
  return new Proxy(ai, {
    get(target, property): unknown {
      return property === "run" ? run : Reflect.get(target, property, target);
    },
  });
}
