import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { watch } from "node:fs";

// Only ciphertext enters the persistent Computer filesystem. The master key
// arrives from a private DO call and is never returned, logged or saved here.
export class AuthVault {
  constructor(home, checkpoint, key) {
    this.home = home;
    this.checkpoint = checkpoint;
    this.key = Buffer.from(key, "base64");
    if (this.key.length !== 32) throw new Error("Invalid credential key");
    this.pending = Promise.resolve();
    this.last = null;
    this.failed = false;
  }
  async restore(saved) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    await mkdir(dirname(this.checkpoint), { recursive: true });
    let envelope;
    try {
      envelope = saved ?? JSON.parse(await readFile(this.checkpoint, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw new Error("Credential recovery failed", { cause: error });
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(Buffer.from("downy-cloud-computer-auth-v1"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    JSON.parse(plain.toString());
    await writeFile(join(this.home, "auth.json"), plain, { mode: 0o600 });
    if (saved)
      await writeFile(this.checkpoint, JSON.stringify(saved), { mode: 0o600 });
    this.last = plain.toString();
  }
  start() {
    this.watcher = watch(this.home, (_event, file) => {
      if (file === "auth.json")
        void this.flush().catch(() => {
          this.failed = true;
        });
    });
  }
  flush() {
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        let plain;
        try {
          plain = await readFile(join(this.home, "auth.json"), "utf8");
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        JSON.parse(plain); // Never checkpoint a partial write.
        if (plain === this.last) return;
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        cipher.setAAD(Buffer.from("downy-cloud-computer-auth-v1"));
        const ciphertext = Buffer.concat([
          cipher.update(plain),
          cipher.final(),
        ]);
        const temp = `${this.checkpoint}.tmp`;
        await writeFile(
          temp,
          JSON.stringify({
            v: 1,
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            ciphertext: ciphertext.toString("base64"),
          }),
          { mode: 0o600 },
        );
        await rename(temp, this.checkpoint);
        this.last = plain;
        this.failed = false;
      });
    return this.pending;
  }
  async snapshot() {
    await this.flush();
    try {
      return JSON.parse(await readFile(this.checkpoint, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  close() {
    this.watcher?.close();
  }
}
