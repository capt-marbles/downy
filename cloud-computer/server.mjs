import { createServer } from "node:http";
import { AuthVault } from "./vault.mjs";
import { CodexBridge } from "./codex.mjs";

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
    if (req.url === "/health") return send(res, 200, { ready: true });
    if (req.url === "/initialize" && req.method === "POST") {
      if (!codex || codex.closed) {
        const input = await readBody(req);
        vault?.close();
        vault = new AuthVault(
          "/private-codex",
          "/workspace/.private/auth.enc.json",
          input.key,
        );
        await vault.restore();
        vault.start();
        codex = new CodexBridge("/private-codex");
        await codex.initialize();
      }
      return send(res, 200, { ready: true });
    }
    if (!codex) return send(res, 503, { error: "Not ready" });
    if (req.url === "/account" && req.method === "GET") {
      await vault.flush();
      return send(res, 200, await codex.account());
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
}).listen(8789, "0.0.0.0");
