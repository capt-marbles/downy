import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthVault } from "../../../cloud-computer/vault.mjs";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
it("restores login after deleting the container disk and preserves refreshed tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "downy-vault-"));
  dirs.push(root);
  const home = join(root, "ephemeral"),
    checkpoint = join(root, "durable", "auth.enc.json");
  const key = Buffer.alloc(32, 7).toString("base64");
  const vault = new AuthVault(home, checkpoint, key);
  await vault.restore();
  const initial = JSON.stringify({
    tokens: { refresh_token: "initial-secret" },
  });
  await writeFile(join(home, "auth.json"), initial);
  await vault.flush();
  const refreshed = JSON.stringify({
    tokens: { refresh_token: "rotated-secret" },
  });
  await writeFile(join(home, "auth.json"), refreshed);
  await vault.flush();
  expect(await readFile(checkpoint, "utf8")).not.toContain("secret");
  await rm(home, { recursive: true });
  const replacement = new AuthVault(home, checkpoint, key);
  await replacement.restore();
  expect(await readFile(join(home, "auth.json"), "utf8")).toBe(refreshed);
});
it("rejects corrupted persisted credentials without silently discarding the login", async () => {
  const root = await mkdtemp(join(tmpdir(), "downy-vault-"));
  dirs.push(root);
  const checkpoint = join(root, "auth.enc.json");
  await writeFile(checkpoint, "corrupt");
  await expect(
    new AuthVault(
      join(root, "ephemeral"),
      checkpoint,
      Buffer.alloc(32).toString("base64"),
    ).restore(),
  ).rejects.toThrow();
});

it("recovers from a DO envelope when the entire container filesystem is replaced", async () => {
  const root = await mkdtemp(join(tmpdir(), "downy-vault-do-"));
  dirs.push(root);
  const home = join(root, "container");
  const checkpoint = join(home, "auth.enc.json");
  const key = Buffer.alloc(32, 9).toString("base64");
  const original = new AuthVault(home, checkpoint, key);
  await original.restore();
  await writeFile(
    join(home, "auth.json"),
    JSON.stringify({ tokens: { refresh_token: "rotated-login" } }),
  );
  const saved = await original.snapshot();
  expect(saved).not.toBeNull();
  expect(JSON.stringify(saved)).not.toContain("rotated-login");
  await rm(home, { recursive: true });
  const replacement = new AuthVault(home, checkpoint, key);
  await replacement.restore(saved!);
  expect(JSON.parse(await readFile(join(home, "auth.json"), "utf8"))).toEqual({
    tokens: { refresh_token: "rotated-login" },
  });
  expect(await replacement.snapshot()).toEqual(saved);
});
