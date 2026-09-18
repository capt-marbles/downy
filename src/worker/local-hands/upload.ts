import { normalizeWorkspacePath } from "../agent/child-workspace-rpc";
import type { LocalHandsAction } from "./types";

export function assertFetchUpload(
  action: LocalHandsAction,
  agentSlug: string,
  connectorId: string,
) {
  if (
    action.agentSlug !== agentSlug ||
    action.status !== "claimed" ||
    action.kind !== "filesystem.fetch" ||
    action.claimedBy !== connectorId
  ) {
    throw new Error("Upload does not match a claimed filesystem.fetch action");
  }
}

export function inboxPath(connectorId: string, destName: string): string {
  for (const segment of [connectorId, destName]) {
    if (
      !segment ||
      /[/\\]/.test(segment) ||
      Array.from(segment).some((character) => character.charCodeAt(0) < 32) ||
      segment === "." ||
      segment === ".."
    )
      throw new Error("Invalid inbox name");
  }
  return normalizeWorkspacePath(`workspace/inbox/${connectorId}/${destName}`);
}

export async function uniqueInboxPath(
  path: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const normalized = normalizeWorkspacePath(path);
  const dot = normalized.lastIndexOf(".");
  const hasExtension = dot > normalized.lastIndexOf("/") + 1;
  const stem = hasExtension ? normalized.slice(0, dot) : normalized;
  const extension = hasExtension ? normalized.slice(dot) : "";
  let candidate = normalized;
  for (let suffix = 2; await exists(candidate); suffix += 1)
    candidate = `${stem}-${suffix}${extension}`;
  return candidate;
}

export async function readFetchBytes(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(
        `FETCH_TOO_LARGE: received ${size} bytes; limit ${limit}`,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
