import { expect, it } from "vitest";
import {
  abortActiveTurns,
  hasActiveTurn,
  ignoreClientCancels,
} from "./ignore-client-cancels";

// The shape of Think's private abort registry, as far as these helpers use it.
function registry() {
  const controllers = new Map<string, AbortController>();
  return {
    controllers,
    getSignal(id: string) {
      if (!controllers.has(id)) controllers.set(id, new AbortController());
      return controllers.get(id)?.signal;
    },
    cancel(id: string) {
      controllers.get(id)?.abort();
    },
    destroyAll() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
    get size() {
      return controllers.size;
    },
  };
}

it("ignores protocol cancels but aborts every turn on an explicit stop", () => {
  const aborts = registry();
  const agent = { _aborts: aborts };
  ignoreClientCancels(agent, "[test]");
  const signal = aborts.getSignal("turn-1");
  aborts.cancel("turn-1");
  expect(signal?.aborted).toBe(false);
  expect(hasActiveTurn(agent)).toBe(true);
  expect(abortActiveTurns(agent)).toBe(1);
  expect(signal?.aborted).toBe(true);
  expect(hasActiveTurn(agent)).toBe(false);
  expect(abortActiveTurns(agent)).toBe(0);
});
