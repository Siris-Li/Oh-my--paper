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
  openTabs,
  onChange,
  onCursorChange,
  onSelectTab,
}: EditorPaneProps) {
  const extensions = useMemo(() => [latexLanguage], []);

  return (
    <div className="panel editor-pane">
      <div className="panel-header editor-header">
        <div>
          <p className="eyebrow">Source</p>
          <h2>{file.path}</h2>
        </div>
        <div className="header-meta-cluster">
          <div className="subtle-tag">{file.language}</div>
          <div className="panel-caption">{file.content.split("\n").length} lines</div>
        </div>
      </div>
      <div className="editor-tabs">
        {openTabs.map((tab) => (
          <button
            key={tab}
            className={`editor-tab ${tab === file.path ? "is-active" : ""}`}
            onClick={() => onSelectTab(tab)}
            type="button"
          >
            {tab.split("/").at(-1)}
          </button>
        ))}
      </div>
      <CodeMirror
        value={file.content}
        minHeight="100%"
        className="editor-surface"
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
  );
}
