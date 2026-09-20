import type { Workspace } from "@cloudflare/shell";
import connecting from "./builtin/connecting-services/SKILL.md?raw";
import reporting from "./builtin/reporting-crm-pipeline/SKILL.md?raw";
import leadSourcing from "./builtin/gameye-lead-sourcing/SKILL.md?raw";
import { parseSkillFile } from "./frontmatter";
import { skillFilePath } from "./types";

export async function seedBuiltinSkills(
  workspace: Pick<Workspace, "exists" | "writeFile">,
) {
  for (const content of [connecting, reporting, leadSourcing]) {
    const parsed = parseSkillFile(content);
    if (!parsed.ok) throw new Error("Invalid bundled skill");
    const path = skillFilePath(parsed.parsed.frontmatter.name);
    // Operator-authored copies always win. These are instructions, not permissions.
    if (!(await workspace.exists(path)))
      await workspace.writeFile(path, content);
  }
}
