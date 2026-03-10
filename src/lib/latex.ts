import type { Diagnostic, GeneratedAsset } from "../types";

export function deriveFigureLabel(filePath: string) {
  return filePath
    .replace(/^assets\/figures\//, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function buildFigureSnippet(asset: GeneratedAsset, caption: string) {
  const label = deriveFigureLabel(asset.filePath);
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  \\includegraphics[width=0.82\\linewidth]{${asset.filePath}}`,
    `  \\caption{${caption || "TODO: add caption"}}`,
    `  \\label{fig:${label}}`,
    "\\end{figure}",
  ].join("\n");
}

export function insertAtLine(source: string, snippet: string, line: number) {
  const lines = source.split("\n");
  const target = Math.max(0, Math.min(lines.length, line));
  lines.splice(target, 0, snippet, "");
  return lines.join("\n");
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]) {
  if (!diagnostics.length) {
    return "Build succeeded without diagnostics.";
  }

  return diagnostics
    .map((item) => `${item.filePath}:${item.line} [${item.level}] ${item.message}`)
    .join("\n");
}
