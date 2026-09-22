import { z } from "zod";

/**
 * A base schema read through Composio costs a long round trip and often an
 * offloaded file. The model reads it before most record reads, and the
 * failed-read text reads it again to list real field names. Keep the
 * projected schema for a short while in the agent's own storage.
 */
const TTL_MS = 10 * 60_000;
const MAX_CHARS = 100_000;
const Entry = z.object({ at: z.number(), result: z.string() });
type Storage = {
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: unknown) => Promise<void>;
};

export const schemaCacheKey = (baseId: string) => `airtable-schema:${baseId}`;

export async function cachedSchemaRead(
  storage: Storage,
  baseId: string,
  read: () => Promise<string>,
  now: () => number = Date.now,
): Promise<string> {
  const key = schemaCacheKey(baseId);
  const hit = Entry.safeParse(await storage.get(key));
  if (hit.success && now() - hit.data.at < TTL_MS) return hit.data.result;
  const result = await read();
  if (result.length <= MAX_CHARS)
    await storage.put(key, { at: now(), result } satisfies z.infer<
      typeof Entry
    >);
  return result;
}
