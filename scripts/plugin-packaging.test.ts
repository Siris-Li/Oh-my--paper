import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceSkillsRoot = path.join(repoRoot, "skills");
const pluginRoots = ["plugins/oh-my-paper", "plugins/oh-my-paper-codex"];
const requiredSkills = [
  "academic-researcher",
  "claude-code-dispatch",
  "codex-dispatch",
  "inno-experiment-dev",
  "inno-paper-writing",
  "literature-pdf-ocr-library",
];

describe("OMP plugin packaging", () => {
  it("ships research skills as real directories in each plugin", () => {
    const expectedFiles = listPackagedFiles(sourceSkillsRoot);

    for (const pluginRoot of pluginRoots) {
      const skillsRoot = path.join(repoRoot, pluginRoot, "skills");
      const skillsRootStat = lstatSync(skillsRoot);

      expect(skillsRootStat.isSymbolicLink(), `${pluginRoot}/skills must not be a symlink`).toBe(false);
      expect(skillsRootStat.isDirectory(), `${pluginRoot}/skills must be a directory`).toBe(true);
      expect(listPackagedFiles(skillsRoot)).toEqual(expectedFiles);

      for (const [relativePath, expectedHash] of Object.entries(expectedFiles)) {
        expect(fileHash(path.join(skillsRoot, relativePath)), `${pluginRoot}/skills/${relativePath}`).toBe(
          expectedHash,
        );
      }

      for (const skill of requiredSkills) {
        const skillFile = path.join(skillsRoot, skill, "SKILL.md");
        expect(lstatSync(skillFile).isFile(), `${pluginRoot}/skills/${skill}/SKILL.md`).toBe(true);
      }
    }
  });

  it("keeps the plugin skill sync script responsible for plugin copies", () => {
    const syncScript = readFileSync(path.join(repoRoot, "scripts/sync-plugin-skills.mjs"), "utf8");

    expect(syncScript).toContain("pluginSkillsRoots");
    expect(syncScript).toContain("plugins/oh-my-paper/skills");
    expect(syncScript).toContain("plugins/oh-my-paper-codex/skills");
  });

  it("checks setup skill resources before copying them", () => {
    const setupCommand = readFileSync(
      path.join(repoRoot, "plugins/oh-my-paper/commands/setup.md"),
      "utf8",
    );

    expect(setupCommand).toContain('[ ! -d "${CLAUDE_PLUGIN_ROOT}/skills" ]');
    expect(setupCommand).toContain("OMP plugin skill resources are missing");
  });
});

function listPackagedFiles(root: string) {
  const files: Record<string, string> = {};
  collectPackagedFiles(root, "", files);
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

function collectPackagedFiles(root: string, relativeDir: string, files: Record<string, string>) {
  const currentDir = path.join(root, relativeDir);
  for (const entryName of readdirSync(currentDir)) {
    if (entryName === "__pycache__" || entryName === ".DS_Store") {
      continue;
    }

    const relativePath = path.join(relativeDir, entryName);
    const fullPath = path.join(root, relativePath);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      collectPackagedFiles(root, relativePath, files);
      continue;
    }

    if (entryName.endsWith(".pyc")) {
      continue;
    }

    files[relativePath.replaceAll(path.sep, "/")] = fileHash(fullPath);
  }
}

function fileHash(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
