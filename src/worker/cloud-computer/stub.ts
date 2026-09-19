export function computerStub(
  env: Env,
  provider: "cloud-computer" | "boat-computer" = "cloud-computer",
): { fetch(request: Request): Promise<Response> } {
  // Optional rollout: selecting this provider must fail explicitly, never fall
  // back to a separately billed model.
  const binding =
    provider === "boat-computer" ? env.BoatComputer : env.CloudComputer;
  if (!binding) throw new Error("Cloud computer is not configured.");
  // One personal account, one credential writer; agents share a serialized
  // inference service, not each other's tool grants or transcript.
  return binding.get(binding.idFromName("personal"));
}
