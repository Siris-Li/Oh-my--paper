import { invoke } from "@tauri-apps/api/core";

import type {
  AgentMessage,
  AgentProfileId,
  FigureBriefDraft,
  GeneratedAsset,
  ProviderConfig,
  SkillManifest,
  SyncLocation,
  WorkspaceSnapshot,
} from "../types";
import { mockRuntime } from "./mockRuntime";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function runOrMock<T>(command: string, args: Record<string, unknown>, fallback: () => Promise<T>) {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }
  return fallback();
}

export const desktop = {
  openProject() {
    return runOrMock("open_project", {}, () => mockRuntime.openProject());
  },
  saveFile(filePath: string, content: string) {
    return runOrMock("save_file", { filePath, content }, () => mockRuntime.saveFile(filePath, content));
  },
  compileProject(filePath: string) {
    return runOrMock("compile_project", { filePath }, () => mockRuntime.compileProject(filePath));
  },
  forwardSearch(filePath: string, line: number) {
    return runOrMock<SyncLocation>("forward_search", { filePath, line }, () => mockRuntime.forwardSearch(filePath, line));
  },
  reverseSearch(page: number) {
    return runOrMock<SyncLocation>("reverse_search", { page }, () => mockRuntime.reverseSearch(page));
  },
  runAgent(profileId: AgentProfileId, filePath: string, selectedText: string) {
    return runOrMock("run_agent", { profileId, filePath, selectedText }, () =>
      mockRuntime.runAgent(profileId, filePath, selectedText),
    );
  },
  applyAgentPatch(filePath: string, content: string) {
    return runOrMock("apply_agent_patch", { filePath, content }, () => mockRuntime.applyAgentPatch(filePath, content));
  },
  listSkills() {
    return runOrMock<SkillManifest[]>("list_skills", {}, () => mockRuntime.listSkills());
  },
  installSkill(skill: SkillManifest) {
    return runOrMock("install_skill", { skill }, () => mockRuntime.installSkill(skill));
  },
  enableSkill(skillId: string, enabled: boolean) {
    return runOrMock("enable_skill", { skillId, enabled }, () => mockRuntime.enableSkill(skillId, enabled));
  },
  listProviders() {
    return runOrMock<ProviderConfig[]>("list_providers", {}, () => mockRuntime.listProviders());
  },
  addProvider(provider: ProviderConfig) {
    return runOrMock("add_provider", { provider }, () => mockRuntime.addProvider(provider));
  },
  updateProvider(providerId: string, patch: Partial<ProviderConfig>) {
    return runOrMock("update_provider", { providerId, patch }, () => mockRuntime.updateProvider(providerId, patch));
  },
  createFigureBrief(sectionRef: string, selectedText: string) {
    return runOrMock<FigureBriefDraft>("create_figure_brief", { sectionRef, selectedText }, () =>
      mockRuntime.createFigureBrief(sectionRef, selectedText),
    );
  },
  runFigureSkill(briefId: string) {
    return runOrMock<FigureBriefDraft>("run_figure_skill", { briefId }, () => mockRuntime.runFigureSkill(briefId));
  },
  runBananaGeneration(briefId: string) {
    return runOrMock<GeneratedAsset>("run_banana_generation", { briefId }, () =>
      mockRuntime.runBananaGeneration(briefId),
    );
  },
  registerGeneratedAsset(asset: GeneratedAsset) {
    return runOrMock("register_generated_asset", { asset }, () => mockRuntime.registerGeneratedAsset(asset));
  },
  insertFigureSnippet(filePath: string, assetId: string, caption: string, line: number) {
    return runOrMock("insert_figure_snippet", { filePath, assetId, caption, line }, () =>
      mockRuntime.insertFigureSnippet(filePath, assetId, caption, line),
    );
  },
  getAgentMessages() {
    return runOrMock<AgentMessage[]>("get_agent_messages", {}, () => mockRuntime.getAgentMessages());
  },
};

export type { WorkspaceSnapshot };
