import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

export async function safeFilePath(sourcePath, allowedRoots, maxBytes) {
  if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
    throw new Error("sourcePath must be an absolute path");
  }
  const resolved = await realpath(path.resolve(sourcePath));
  const roots = await Promise.all(allowedRoots.map((root) => realpath(root)));
  if (
    !roots.some(
      (root) =>
        resolved === root ||
        resolved.startsWith(
          root.endsWith(path.sep) ? root : `${root}${path.sep}`,
        ),
    )
  ) {
    throw new Error("sourcePath is outside DOWNY_HANDS_ALLOWED_ROOTS");
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("sourcePath must be a regular file");
  if (info.size > maxBytes)
    throw new Error(`File size ${info.size} exceeds ${maxBytes} bytes`);
  return resolved;
}

export async function executeFilesystemFetch(action, options) {
  const { allowedRoots, maxBytes, upload } = options;
  const sourcePath = await safeFilePath(
    action.input.sourcePath,
    allowedRoots,
    maxBytes,
  );
  const destName =
    action.input.destName ?? path.basename(action.input.sourcePath);
  // Open without following a replaced final symlink; verify the opened file too.
  const { constants } = await import("node:fs");
  const file = await open(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("sourcePath must be a regular file");
    if (info.size > maxBytes)
      throw new Error(`File size ${info.size} exceeds ${maxBytes} bytes`);
    const hash = createHash("sha256");
    let bytes = 0;
    async function* chunks() {
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        bytes += chunk.length;
        if (bytes > maxBytes)
          throw new Error(`File size ${bytes} exceeds ${maxBytes} bytes`);
        hash.update(chunk);
        yield chunk;
      }
    }
    const contentType = "application/octet-stream";
    const result = await upload({
      destName,
      contentType,
      body: Readable.toWeb(Readable.from(chunks())),
    });
    const sha256 = hash.digest("hex");
    if (result.bytes !== bytes || result.sha256 !== sha256)
      throw new Error("Uploaded file integrity check failed");
    return {
      workspacePath: result.workspacePath,
      bytes,
      sha256,
      contentType,
      sourcePath,
    };
  } finally {
    await file.close();
  }
}
