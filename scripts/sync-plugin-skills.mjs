import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceSkillsRoot = path.join(repoRoot, "skills");
const pluginSkillsRoots = [
  path.join(repoRoot, "plugins/oh-my-paper/skills"),
  path.join(repoRoot, "plugins/oh-my-paper-codex/skills"),
];

const mode = process.argv[2] || "check";
if (!["sync", "check"].includes(mode)) {
  throw new Error("Usage: node scripts/sync-plugin-skills.mjs <sync|check>");
}

if (!isDirectory(sourceSkillsRoot)) {
  throw new Error(`Missing source skills directory: ${sourceSkillsRoot}`);
}

if (mode === "sync") {
  for (const pluginSkillsRoot of pluginSkillsRoots) {
    replaceDirectory(sourceSkillsRoot, pluginSkillsRoot);
  }
  process.stdout.write(`Synced plugin skills from ${rel(sourceSkillsRoot)}.\n`);
} else {
  const expected = listPackagedFiles(sourceSkillsRoot);
  const differences = [];

  for (const pluginSkillsRoot of pluginSkillsRoots) {
    if (!isDirectory(pluginSkillsRoot)) {
      differences.push(`${rel(pluginSkillsRoot)} is not a directory`);
      continue;
    }
    if (lstatSync(pluginSkillsRoot).isSymbolicLink()) {
      differences.push(`${rel(pluginSkillsRoot)} is a symlink`);
      continue;
    }

    const actual = listPackagedFiles(pluginSkillsRoot);
    const rootDifferences = diffFileMaps(expected, actual, pluginSkillsRoot);
    differences.push(...rootDifferences);
  }

  if (differences.length > 0) {
    process.stderr.write(`Plugin skills are out of sync:\n${differences.map((item) => `  - ${item}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Plugin skills are in sync.\n");
  }
}

function replaceDirectory(sourceRoot, targetRoot) {
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });

  for (const [relativePath] of Object.entries(listPackagedFiles(sourceRoot))) {
    const sourceFile = path.join(sourceRoot, relativePath);
    const targetFile = path.join(targetRoot, relativePath);
    mkdirSync(path.dirname(targetFile), { recursive: true });
    copyFileSync(sourceFile, targetFile);
  }
}

function diffFileMaps(expected, actual, pluginSkillsRoot) {
  const differences = [];
  const paths = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  for (const relativePath of [...paths].sort()) {
    if (!(relativePath in actual)) {
      differences.push(`${rel(pluginSkillsRoot)}/${relativePath} is missing`);
      continue;
    }
    if (!(relativePath in expected)) {
      differences.push(`${rel(pluginSkillsRoot)}/${relativePath} is extra`);
      continue;
    }
    if (actual[relativePath] !== expected[relativePath]) {
      differences.push(`${rel(pluginSkillsRoot)}/${relativePath} differs from skills/${relativePath}`);
    }
  }

  return differences;
}

function listPackagedFiles(root) {
  const files = {};
  collectPackagedFiles(root, "", files);
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

function collectPackagedFiles(root, relativeDir, files) {
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

function fileHash(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function isDirectory(filePath) {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}
