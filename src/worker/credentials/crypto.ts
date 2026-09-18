import { z } from "zod";

export type SecretBinding = string | { get(): Promise<string> };
export async function readSecret(
  binding: SecretBinding | undefined,
): Promise<string> {
  const value = typeof binding === "string" ? binding : await binding?.get();
  if (!value) throw new Error("Required secret binding is not configured");
  return value;
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export type CredentialEnvelope = {
  v: 1;
  iv: string;
  ciphertext: string;
  keyIv: string;
  wrappedKey: string;
};
async function masterKey(secret: string) {
  const bytes = decode(secret);
  if (bytes.length !== 32)
    throw new Error("CREDENTIAL_KEY must be base64 of 32 random bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptHeaders(
  headers: Record<string, string>,
  secret: string,
  context: string,
): Promise<CredentialEnvelope> {
  const master = await masterKey(secret);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyIv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(context);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    new TextEncoder().encode(JSON.stringify(headers)),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: keyIv, additionalData },
    master,
    rawKey,
  );
  return {
    v: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
    keyIv: encode(keyIv),
    wrappedKey: encode(new Uint8Array(wrappedKey)),
  };
}
export async function decryptHeaders(
  envelope: CredentialEnvelope,
  secret: string,
  context: string,
): Promise<Record<string, string>> {
  const additionalData = new TextEncoder().encode(context);
  const rawKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(envelope.keyIv), additionalData },
    await masterKey(secret),
    decode(envelope.wrappedKey),
  );
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "decrypt",
  ]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(envelope.iv), additionalData },
    key,
    decode(envelope.ciphertext),
  );
  return z
    .record(z.string(), z.string())
    .parse(JSON.parse(new TextDecoder().decode(plain)) as unknown);
}
