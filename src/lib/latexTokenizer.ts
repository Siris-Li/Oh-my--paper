import katex from "katex";

export type TokenType = "command" | "math" | "comment" | "brace" | "text" | "whitespace";

export interface Token {
  type: TokenType;
  text: string;
}

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Comment: % to end of line
    if (line[i] === "%") {
      tokens.push({ type: "comment", text: line.slice(i) });
      break;
    }

    // Command: \commandname
    if (line[i] === "\\") {
      let j = i + 1;
      while (j < line.length && /[a-zA-Z]/.test(line[j])) j++;
      // If no letters follow, it's a single-char command (e.g. \\ or \{)
      if (j === i + 1 && j < line.length) j++;
      tokens.push({ type: "command", text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Math: $$...$$ or $...$
    if (line[i] === "$") {
      if (line[i + 1] === "$") {
        // Display math $$...$$
        const end = line.indexOf("$$", i + 2);
        if (end !== -1) {
          tokens.push({ type: "math", text: line.slice(i, end + 2) });
          i = end + 2;
        } else {
          tokens.push({ type: "math", text: line.slice(i) });
          break;
        }
      } else {
        // Inline math $...$
        const end = line.indexOf("$", i + 1);
        if (end !== -1) {
          tokens.push({ type: "math", text: line.slice(i, end + 1) });
          i = end + 1;
        } else {
          tokens.push({ type: "math", text: line.slice(i) });
          break;
        }
      }
      continue;
    }

    // Braces
    if (line[i] === "{" || line[i] === "}") {
      tokens.push({ type: "brace", text: line[i] });
      i++;
      continue;
    }

    // Whitespace
    if (/\s/.test(line[i])) {
      let j = i + 1;
      while (j < line.length && /\s/.test(line[j])) j++;
      tokens.push({ type: "whitespace", text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Text: accumulate until a special char
    let j = i + 1;
    while (j < line.length && !/[%\\${}]/.test(line[j]) && !/\s/.test(line[j])) j++;
    tokens.push({ type: "text", text: line.slice(i, j) });
    i = j;
  }

  return tokens;
}

const SECTION_COMMANDS = new Set([
  "\\section",
  "\\subsection",
  "\\subsubsection",
  "\\chapter",
  "\\part",
]);

export function isSectionCommand(cmd: string): boolean {
  return SECTION_COMMANDS.has(cmd);
}

export function getSectionLevel(cmd: string): number {
  switch (cmd) {
    case "\\chapter":
    case "\\part":
      return 1;
    case "\\section":
      return 2;
    case "\\subsection":
      return 3;
    case "\\subsubsection":
      return 4;
    default:
      return 0;
  }
}

export function renderMathToken(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode });
  } catch {
    return "";
  }
}

export interface MathBlock {
  startLine: number;
  endLine: number;
  tex: string;
  displayMode: boolean;
}

const MATH_ENV_NAMES = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "multline", "multline*", "eqnarray", "eqnarray*", "math", "displaymath",
  "flalign", "flalign*", "alignat", "alignat*",
]);

export function findMathBlocks(lines: string[]): MathBlock[] {
  const blocks: MathBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    // Check \[ ... \]
    if (trimmed.startsWith("\\[")) {
      const start = i;
      while (i < lines.length && !lines[i].includes("\\]")) i++;
      blocks.push({
        startLine: start,
        endLine: i,
        tex: lines.slice(start, i + 1).join("\n").replace(/^\s*\\\[/, "").replace(/\\\]\s*$/, ""),
        displayMode: true,
      });
      i++;
      continue;
    }
    // Check $$ ... $$ (multi-line)
    if (trimmed === "$$") {
      const start = i;
      i++;
      while (i < lines.length && lines[i].trimStart() !== "$$") i++;
      blocks.push({
        startLine: start,
        endLine: i,
        tex: lines.slice(start + 1, i).join("\n"),
        displayMode: true,
      });
      i++;
      continue;
    }
    // Check \begin{mathenv}
    const envMatch = trimmed.match(/^\\begin\{([^}]+)\}/);
    if (envMatch && MATH_ENV_NAMES.has(envMatch[1])) {
      const envName = envMatch[1];
      const start = i;
      const endTag = `\\end{${envName}}`;
      i++;
      while (i < lines.length && !lines[i].includes(endTag)) i++;
      const rawLines = lines.slice(start, i + 1).join("\n");
      blocks.push({
        startLine: start,
        endLine: i,
        tex: rawLines,
        displayMode: true,
      });
      i++;
      continue;
    }
    i++;
  }
  return blocks;
}
