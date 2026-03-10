import process from "node:process";
import { randomUUID } from "node:crypto";

function now() {
  return new Date().toISOString();
}

function parsePayload() {
  const raw = process.argv[3] ?? "{}";
  return JSON.parse(raw);
}

function runAgent() {
  const payload = parsePayload();
  const contentByProfile = {
    outline: [
      "\\subsection{Research Questions}",
      "Define the evaluation question, workflow boundary, and figure generation boundary.",
      "",
      "\\subsection{System Boundary}",
      "Clarify which actions remain user-confirmed instead of fully automated.",
    ].join("\n"),
    draft: `Draft expansion for ${payload.filePath}: convert notes into a compact academic paragraph anchored in the selected passage.`,
    polish: "Polish rewrite: reduce repeated framing and replace generic claims with specific evidence-bearing statements.",
    de_ai: "De-AI rewrite: remove predictable transitions, inflated abstraction, and rhythmic over-explanation.",
    review: [
      "1. State the non-goals of V1 earlier.",
      "2. Prove the figure workflow with an end-to-end example.",
      "3. Tie compile diagnostics back to writing feedback.",
    ].join("\n"),
  };

  const content = contentByProfile[payload.profileId] ?? "No profile result.";
  const result = {
    message: {
      id: randomUUID(),
      role: "assistant",
      profileId: payload.profileId,
      content,
      timestamp: now(),
    },
    suggestedPatch:
      payload.profileId === "review"
        ? null
        : {
            filePath: payload.filePath,
            content,
            summary: `${payload.profileId} patch prepared by sidecar.`,
          },
  };
  process.stdout.write(JSON.stringify(result));
}

function runFigureSkill() {
  const payload = parsePayload();
  process.stdout.write(
    JSON.stringify({
      id: payload.briefId,
      sourceSectionRef: "active-section",
      briefMarkdown: `${payload.briefMarkdown}\n\n## Style direction\nUse a journal-style workflow figure with restrained color and numbered stages.`,
      promptPayload: `${payload.promptPayload} Return a clean wide workflow figure with four stages and subtle neutral tones.`,
      status: "ready",
    }),
  );
}

function runBanana() {
  const payload = parsePayload();
  const previewUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <rect width="1200" height="720" fill="#f4efe6"/>
      <rect x="76" y="96" width="1048" height="528" rx="34" fill="#fffaf2" stroke="#af8d61" stroke-width="4"/>
      <text x="124" y="164" font-size="34" font-family="Georgia, serif" fill="#32271f">ViewerLeaf Figure Workspace</text>
      <g font-family="Menlo, monospace" font-size="22" fill="#524537">
        <rect x="124" y="240" width="210" height="96" rx="18" fill="#e6dbca"/>
        <text x="164" y="298">Select section</text>
        <rect x="384" y="240" width="210" height="96" rx="18" fill="#dce7da"/>
        <text x="430" y="298">Refine brief</text>
        <rect x="644" y="240" width="210" height="96" rx="18" fill="#eee0cb"/>
        <text x="676" y="298">Banana render</text>
        <rect x="904" y="240" width="150" height="96" rx="18" fill="#e2d4be"/>
        <text x="938" y="298">Insert</text>
      </g>
      <g stroke="#9d7d54" stroke-width="8" fill="none" stroke-linecap="round">
        <path d="M334 288 H384"/>
        <path d="M594 288 H644"/>
        <path d="M854 288 H904"/>
      </g>
      <text x="124" y="420" font-size="24" font-family="Georgia, serif" fill="#5e4b37">Prompt payload</text>
      <foreignObject x="124" y="444" width="920" height="140">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Menlo, monospace; font-size: 18px; color: #4e4336; line-height: 1.5;">
          ${payload.promptPayload}
        </div>
      </foreignObject>
    </svg>
  `)}`;

  process.stdout.write(
    JSON.stringify({
      id: randomUUID(),
      kind: "figure",
      filePath: `assets/figures/sidecar-figure-${Date.now()}.svg`,
      sourceBriefId: payload.briefId,
      metadata: {
        generator: "banana",
        createdAt: now(),
        format: "svg",
      },
      previewUri,
    }),
  );
}

const command = process.argv[2];

if (command === "agent") {
  runAgent();
} else if (command === "figure-skill") {
  runFigureSkill();
} else if (command === "banana") {
  runBanana();
} else {
  process.stderr.write(`Unknown sidecar command: ${command}`);
  process.exitCode = 1;
}
