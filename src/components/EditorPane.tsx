import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

import type { ProjectFile } from "../types";

interface EditorPaneProps {
  file: ProjectFile;
  openTabs: string[];
  onChange: (value: string) => void;
  onCursorChange: (line: number, selectedText: string) => void;
  onSelectTab: (path: string) => void;
}

const latexLanguage = StreamLanguage.define(stex);

export function EditorPane({
  file,
  onChange,
  onCursorChange,
}: EditorPaneProps) {
  const extensions = useMemo(() => [latexLanguage], []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border-light)", fontSize: "12px", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between", background: "var(--bg-app)" }}>
        <span>源码路径: {file.path}</span>
        <span>{file.language} · 共 {file.content.split("\n").length} 行</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <CodeMirror
          value={file.content}
          height="100%"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            foldGutter: false,
          }}
          extensions={extensions}
          onChange={onChange}
          onUpdate={(update) => {
            if (update.selectionSet || update.docChanged) {
              const main = update.state.selection.main;
              const line = update.state.doc.lineAt(main.head).number;
              const selectedText = update.state.sliceDoc(main.from, main.to);
              onCursorChange(line, selectedText);
            }
          }}
        />
      </div>
    </div>
  );
}
