// Scratch proxy: POST {state, questions} -> env.AI.run("typesafe/jev", ...)
// Returns the raw Workers AI response plus wall-clock latency so experiments
// can measure the binding path exactly as Downy uses it.
export default {
  async fetch(request, env) {
    if (request.method !== "POST")
      return new Response("POST {state, questions}", { status: 405 });
    const body = await request.json();
    const t0 = Date.now();
    try {
      const raw = await env.AI.run("typesafe/jev", body);
      return Response.json({ ms: Date.now() - t0, raw });
    } catch (err) {
      return Response.json(
        { ms: Date.now() - t0, error: String(err?.message ?? err) },
        { status: 502 },
      );
    }
  },
};
