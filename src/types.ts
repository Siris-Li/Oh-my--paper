export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";
export type BibTool = "bibtex" | "biber" | "auto";
export type CompileStatus = "idle" | "running" | "success" | "failed" | "canceled";
export type AgentProfileId = "outline" | "draft" | "polish" | "de_ai" | "review";
export type FigureBriefStatus = "draft" | "ready" | "generated";
export type AssetKind = "figure";
export type DrawerTab = "explorer" | "ai" | "logs" | "figures" | "skills" | "providers";

export interface ProjectConfig {
  rootPath: string;
  mainTex: string;
  engine: LatexEngine;
  bibTool: BibTool;
  autoCompile: boolean;
  forwardSync: boolean;
}

export interface ProjectFile {
  path: string;
  language: "latex" | "bib" | "text" | "json";
  content: string;
}

export interface ProjectNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file" | "asset";
  children?: ProjectNode[];
}

export interface Diagnostic {
  filePath: string;
  line: number;
  level: "error" | "warning" | "info";
  message: string;
}

export interface CompileResult {
  status: CompileStatus;
  pdfPath?: string;
  pdfData?: Uint8Array;
  synctexPath?: string;
  diagnostics: Diagnostic[];
  logPath: string;
  logOutput: string;
  timestamp: string;
}

export interface SyncLocation {
  filePath: string;
  line: number;
  column: number;
  page: number;
}

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  stages: string[];
  promptFiles: string[];
  toolAllowlist: string[];
  enabled: boolean;
  source: "git" | "zip" | "local";
}

export interface ProviderConfig {
  id: string;
  vendor: string;
  baseUrl: string;
  authRef: string;
  defaultModel: string;
}

export interface AgentProfile {
  id: AgentProfileId;
  stage: string;
  providerId: string;
  model: string;
  skillIds: string[];
  toolAllowlist: string[];
  outputMode: "rewrite" | "outline" | "review";
  label: string;
  summary: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  profileId: AgentProfileId;
  content: string;
  timestamp: string;
}

export interface AgentRunResult {
  message: AgentMessage;
  suggestedPatch?: {
    filePath: string;
    content: string;
    summary: string;
  };
}

export interface FigureBriefDraft {
  id: string;
  sourceSectionRef: string;
  briefMarkdown: string;
  promptPayload: string;
  status: FigureBriefStatus;
}

export interface GeneratedAsset {
  id: string;
  kind: AssetKind;
  filePath: string;
  sourceBriefId: string;
  metadata: Record<string, string>;
  previewUri: string;
}

export interface WorkspaceSnapshot {
  projectConfig: ProjectConfig;
  tree: ProjectNode[];
  files: ProjectFile[];
  activeFile: string;
  providers: ProviderConfig[];
  skills: SkillManifest[];
  profiles: AgentProfile[];
  compileResult: CompileResult;
  figureBriefs: FigureBriefDraft[];
  assets: GeneratedAsset[];
}
