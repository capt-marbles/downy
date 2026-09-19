import { expect, it, vi } from "vitest";
import { AUTH_CHECKPOINT_KEY, saveAccountCheckpoint } from "./auth-checkpoint";

const checkpoint = {
  v: 1,
  iv: "a".repeat(16),
  tag: "b".repeat(24),
  ciphertext: "encrypted",
};
it("does not report connected until durable storage acknowledges the encrypted login", async () => {
  let acknowledge!: () => void;
  const put = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  let connected = false;
  const save = saveAccountCheckpoint(
    { put },
    { authenticated: true, checkpoint },
  ).then((value) => {
    connected = value;
  });
  await Promise.resolve();
  expect(connected).toBe(false);
  expect(put).toHaveBeenCalledWith(AUTH_CHECKPOINT_KEY, checkpoint);
  acknowledge();
  await save;
  expect(connected).toBe(true);
});
it("fails explicitly when an authenticated account has no checkpoint or storage fails", async () => {
  const put = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
  await expect(
    saveAccountCheckpoint({ put }, { authenticated: true, checkpoint: null }),
  ).rejects.toThrow("recoverable login");
  expect(put).not.toHaveBeenCalled();
  await expect(
    saveAccountCheckpoint({ put }, { authenticated: true, checkpoint }),
  ).rejects.toThrow("Storage unavailable");
});
it("allows an initial signed-out account without manufacturing saved credentials", async () => {
  const put = vi.fn();
  expect(
    await saveAccountCheckpoint(
      { put },
      { authenticated: false, checkpoint: null },
    ),
  ).toBe(false);
  expect(put).not.toHaveBeenCalled();
});
it("rejects plaintext in place of an encrypted envelope", async () => {
  const put = vi.fn();
  await expect(
    saveAccountCheckpoint(
      { put },
      {
        authenticated: true,
        checkpoint: { tokens: { refresh_token: "test-secret" } },
      },
    ),
  ).rejects.toThrow();
  expect(put).not.toHaveBeenCalled();
});
