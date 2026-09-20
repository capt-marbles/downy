import { z } from "zod";
import { readSecret, type SecretBinding } from "../credentials/crypto";
const RecordSchema = z.record(z.string(), z.unknown());
export async function composio(
  binding: SecretBinding | undefined,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://backend.composio.dev/api/v3.1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-api-key": await readSecret(binding),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Composio request failed (${response.status})`);
  return RecordSchema.parse(await response.json());
}
export const ToolkitSchema = z.object({
  slug: z.string(),
  name: z.string(),
  composio_managed_auth_schemes: z.array(z.string()).default([]),
  auth_config_details: z
    .array(
      z.object({
        mode: z.string(),
        fields: z
          .object({
            connected_account_initiation: z
              .object({
                required: z
                  .array(
                    z.object({
                      name: z.string(),
                      displayName: z.string().optional(),
                      description: z.string().optional(),
                    }),
                  )
                  .default([]),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
export const ToolListSchema = z.object({
  items: z.array(z.object({ slug: z.string(), name: z.string().optional() })),
});
