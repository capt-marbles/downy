import { expect, it, vi } from "vitest";
import { cachedSchemaRead, schemaCacheKey } from "./airtable-schema-cache";

function storage() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async (key: string) => map.get(key),
    put: async (key: string, value: unknown) => {
      map.set(key, value);
    },
  };
}

it("reads a base schema once per ten minutes and never stores an oversized one", async () => {
  const store = storage();
  let now = 1_000_000;
  const read = vi.fn(async () => '{"account":"a","data":{"tables":[]}}');
  const clock = () => now;
  expect(await cachedSchemaRead(store, "appA", read, clock)).toContain(
    "tables",
  );
  expect(await cachedSchemaRead(store, "appA", read, clock)).toContain(
    "tables",
  );
  expect(read).toHaveBeenCalledTimes(1);
  now += 11 * 60_000;
  await cachedSchemaRead(store, "appA", read, clock);
  expect(read).toHaveBeenCalledTimes(2);
  const big = vi.fn(async () => "x".repeat(100_001));
  await cachedSchemaRead(store, "appB", big, clock);
  await cachedSchemaRead(store, "appB", big, clock);
  expect(big).toHaveBeenCalledTimes(2);
  expect(store.map.has(schemaCacheKey("appB"))).toBe(false);
});
