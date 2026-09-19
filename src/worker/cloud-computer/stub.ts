import type { CloudComputer } from "./CloudComputer";

export function computerStub(env: Env): DurableObjectStub<CloudComputer> {
  // Optional rollout: selecting this provider must fail explicitly, never fall
  // back to a separately billed model.
  const binding = env.CloudComputer;
  if (!binding) throw new Error("Cloud computer is not configured.");
  // One personal account, one credential writer; agents share a serialized
  // inference service, not each other's tool grants or transcript.
  return binding.get(binding.idFromName("personal"));
}
