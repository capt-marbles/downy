import { expect, it, vi } from "vitest";
import { seedBuiltinSkills } from "./builtin";
import { parseSkillFile } from "./frontmatter";
it("seeds valid portable skills and preserves operator-authored copies", async () => {
  const files = new Map<string, string>([
    ["skills/connecting-services/SKILL.md", "operator copy"],
  ]);
  const writeFile = vi.fn(async (path: string, content: string) => {
    files.set(path, content);
  });
  const workspace = {
    exists: async (path: string) => files.has(path),
    writeFile,
  };
  await seedBuiltinSkills(workspace);
  await seedBuiltinSkills(workspace);
  expect(writeFile).toHaveBeenCalledTimes(1);
  expect(files.get("skills/connecting-services/SKILL.md")).toBe(
    "operator copy",
  );
  const parsed = parseSkillFile(
    files.get("skills/reporting-crm-pipeline/SKILL.md")!,
  );
  expect(parsed.ok).toBe(true);
});
