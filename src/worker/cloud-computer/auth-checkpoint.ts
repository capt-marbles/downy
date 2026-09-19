import { z } from "zod";

export const AUTH_CHECKPOINT_KEY = "computer-auth-checkpoint";
const EnvelopeSchema = z.object({
  v: z.literal(1),
  iv: z.string().length(16),
  tag: z.string().length(24),
  ciphertext: z.string().min(1).max(200_000),
});
const AccountSchema = z.object({
  authenticated: z.boolean(),
  checkpoint: EnvelopeSchema.nullable(),
});

// Only encrypted data crosses this private bridge boundary. A successful account
// check is not a durable login until the DO has acknowledged its storage write.
export async function saveAccountCheckpoint(
  storage: Pick<DurableObjectStorage, "put">,
  body: unknown,
): Promise<boolean> {
  const account = AccountSchema.parse(body);
  if (account.authenticated && !account.checkpoint)
    throw new Error("Connected account has no recoverable login");
  if (account.checkpoint)
    await storage.put(AUTH_CHECKPOINT_KEY, account.checkpoint);
  return account.authenticated;
}
