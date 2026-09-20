// Shared helpers for Jev experiments.
// Two transports:
//   - workers-ai: local wrangler dev proxy at :8799 -> env.AI.run("typesafe/jev") (Downy's production path)
//   - typesafe:   direct https://api.typesafe.ai/v1/systemone (needs TYPESAFE_API_KEY)
const PROXY = process.env.JEV_PROXY ?? "http://localhost:8799";
const KEY = process.env.TYPESAFE_API_KEY;

export const noul = (instructions, criteria) => ({
  type: "noul",
  instructions,
  ...(criteria ? { criteria } : {}),
});
export const choice = (instructions, criteria) => ({
  type: "choice",
  instructions,
  criteria,
});
export const score = (instructions, criteria) => ({
  type: "score",
  instructions,
  criteria,
});

export async function jev(
  state,
  questions,
  { transport = process.env.JEV_TRANSPORT ?? "workers-ai" } = {},
) {
  const t0 = performance.now();
  let result, ms;
  if (transport === "typesafe") {
    if (!KEY) throw new Error("TYPESAFE_API_KEY not set");
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ state, questions, model: "jev-latest" }),
    });
    ms = performance.now() - t0;
    if (!res.ok) throw new Error(`typesafe ${res.status}: ${await res.text()}`);
    result = await res.json();
  } else {
    const res = await fetch(PROXY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, questions }),
    });
    const body = await res.json();
    ms = performance.now() - t0;
    if (body.error) throw new Error(body.error);
    const raw = body.raw;
    result = raw?.state === "Completed" ? raw.result : raw;
  }
  return { ms: Math.round(ms), ...result };
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
export function stdev(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
export const pct = (x) => `${Math.round(x * 100)}%`;
export function table(rows) {
  console.table(rows);
}
export async function pool(items, fn, n = 8) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}
