import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { AuthVault } from "../cloud-computer/vault.mjs";
import { CodexBridge } from "../cloud-computer/codex.mjs";

const token = (
  await readFile(
    process.env.DOWNY_BOAT_TOKEN_FILE ?? "/home/user/.downy-boat/bridge-token",
    "utf8",
  )
).trim();
if (token.length < 32) throw new Error("Boat bridge token is not configured");
const expected = Buffer.from(`Bearer ${token}`);

let vault,
  codex,
  busy = false;
const send = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};
async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
createServer(async (req, res) => {
  try {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return send(res, 401, { error: "Unauthorized" });
    if (req.url === "/health") return send(res, 200, { ready: true });
    if (req.url === "/initialize" && req.method === "POST") {
      if (!codex || codex.closed) {
        const input = await readBody(req);
        vault?.close();
        vault = new AuthVault(
          "/run/downy-boat",
          "/home/user/.downy-boat/auth.enc.json",
          input.key,
        );
        await vault.restore(input.checkpoint);
        vault.start();
        codex = new CodexBridge("/run/downy-boat");
        await codex.initialize();
      }
      return send(res, 200, { ready: true });
    }
    if (!codex) return send(res, 503, { error: "Not ready" });
    if (req.url === "/account" && req.method === "GET") {
      const account = await codex.account();
      // Confirm the account first, then checkpoint its current credential file.
      // The DO must commit this encrypted envelope before reporting connected.
      const checkpoint = await vault.snapshot();
      if (account.authenticated && !checkpoint)
        throw new Error("Authenticated login has no checkpoint");
      return send(res, 200, { ...account, checkpoint });
    }
    if (busy) return send(res, 409, { error: "Busy" });
    busy = true;
    try {
      if (req.url === "/login" && req.method === "POST")
        return send(res, 200, await codex.login());
      if (req.url === "/step" && req.method === "POST") {
        const input = await readBody(req);
        const result = await codex.step(input);
        await vault.flush();
        return send(res, 200, result);
      }
      return send(res, 404, { error: "Not found" });
    } finally {
      busy = false;
    }
  } catch (error) {
    // Never emit provider errors, stderr, request bodies, URLs or auth state.
    await vault?.flush().catch(() => {});
    send(res, [401, 429].includes(error.status) ? error.status : 503, {
      error:
        error.status === 401
          ? "Reconnect ChatGPT"
          : "Cloud computer step failed",
    });
  }
}).listen(Number(process.env.DOWNY_BOAT_PORT ?? 8789), "0.0.0.0");
