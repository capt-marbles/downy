import { z } from "zod";
export const CorpusRepoSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  projectId: z.string().min(1),
  ref: z.string().min(1),
  include: z.array(z.string()).min(1),
  extensions: z.array(z.string().startsWith(".")).min(1),
});
export type CorpusRepo = z.infer<typeof CorpusRepoSchema>;
export function corpusRepos(value: string): CorpusRepo[] {
  return z.array(CorpusRepoSchema).parse(JSON.parse(value) as unknown);
}
const EntrySchema = z.object({
  blobId: z.string(),
  skipped: z.string().optional(),
});
export const ManifestSchema = z.object({
  commit: z.string(),
  files: z.record(z.string(), EntrySchema),
});
export type CorpusManifest = z.infer<typeof ManifestSchema>;
export const CursorSchema = z.object({
  commit: z.string(),
  page: z.number(),
  tree: z.record(z.string(), z.string()),
  paths: z.array(z.string()).nullable(),
  index: z.number(),
  removals: z.array(z.string()),
  removeIndex: z.number(),
  partial: z.boolean(),
  manifest: ManifestSchema,
});
export type CorpusCursor = z.infer<typeof CursorSchema>;
