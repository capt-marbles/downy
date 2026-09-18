import { z } from "zod";
const digest = (value: string) =>
  crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

async function validWebhookToken(
  received: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([digest(received), digest(expected)]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
export async function readPush(request: Request, secret: string) {
  if (
    !(await validWebhookToken(
      request.headers.get("x-gitlab-token") ?? "",
      secret,
    ))
  )
    return null;
  return z
    .object({
      object_kind: z.literal("push"),
      ref: z.string(),
      project: z.object({ id: z.number(), path_with_namespace: z.string() }),
      commits: z.array(
        z.object({
          added: z.array(z.string()),
          modified: z.array(z.string()),
          removed: z.array(z.string()),
        }),
      ),
    })
    .parse(await request.json());
}
