import { describe, expect, it } from "vitest";

import { buildFigureSnippet, deriveFigureLabel, insertAtLine } from "./latex";

describe("latex helpers", () => {
  it("derives a stable figure label from the asset path", () => {
    expect(deriveFigureLabel("assets/figures/Workflow Figure 1.svg")).toBe("workflow-figure-1");
  });

  it("builds a LaTeX figure environment", () => {
    const snippet = buildFigureSnippet(
      {
        id: "1",
        kind: "figure",
        filePath: "assets/figures/figure-1.svg",
        sourceBriefId: "brief-1",
        metadata: {},
        previewUri: "data:image/svg+xml,stub",
      },
      "Workflow overview",
    );

    expect(snippet).toContain("\\begin{figure}");
    expect(snippet).toContain("\\caption{Workflow overview}");
    expect(snippet).toContain("\\label{fig:figure-1}");
  });

  it("inserts snippets at the requested line", () => {
    const source = ["a", "b", "c"].join("\n");
    expect(insertAtLine(source, "FIGURE", 1)).toBe(["a", "FIGURE", "", "b", "c"].join("\n"));
  });
});
