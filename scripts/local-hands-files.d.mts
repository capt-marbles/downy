export function safeFilePath(
  sourcePath: string,
  allowedRoots: string[],
  maxBytes: number,
): Promise<string>;
export function executeFilesystemFetch(
  action: { input: { sourcePath: string; destName?: string } },
  options: {
    allowedRoots: string[];
    maxBytes: number;
    upload: (input: {
      destName: string;
      contentType: string;
      body: ReadableStream<Uint8Array>;
    }) => Promise<{ workspacePath: string; bytes: number; sha256: string }>;
  },
): Promise<{
  workspacePath: string;
  bytes: number;
  sha256: string;
  contentType: string;
  sourcePath: string;
}>;
