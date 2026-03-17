import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import "katex/dist/katex.min.css";
import { tokenizeLine, isSectionCommand, getSectionLevel, renderMathToken, findMathBlocks } from "../lib/latexTokenizer";

interface VisualEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onSwitchToCode: () => void;
}

function tokensToHtml(line: string): string {
  const tokens = tokenizeLine(line);
  if (tokens.length === 0) return "\u200B"; // zero-width space for empty lines
  return tokens
    .map((tok) => {
      const escaped = tok.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (tok.type === "command") return `<span class="ve-tok-command">${escaped}</span>`;
      if (tok.type === "math") {
        const isDisplay = tok.text.startsWith("$$");
        const inner = isDisplay
          ? tok.text.slice(2, tok.text.endsWith("$$") ? -2 : undefined)
          : tok.text.slice(1, tok.text.endsWith("$") ? -1 : undefined);
        const rendered = renderMathToken(inner, isDisplay);
        if (rendered) {
          const tag = isDisplay ? "div" : "span";
          return `<${tag} class="ve-tok-math-rendered" title="${escaped}">${rendered}</${tag}>`;
        }
        return `<span class="ve-tok-math">${escaped}</span>`;
      }
      if (tok.type === "comment") return `<span class="ve-tok-comment">${escaped}</span>`;
      if (tok.type === "brace") return `<span class="ve-tok-brace">${escaped}</span>`;
      return escaped;
    })
    .join("");
}

function getLineHeadingClass(line: string): string {
  const trimmed = line.trimStart();
  const match = trimmed.match(/^(\\[a-zA-Z]+)/);
  if (match && isSectionCommand(match[1])) {
    const level = getSectionLevel(match[1]);
    return `ve-heading-${level}`;
  }
  return "";
}

export function VisualEditor({ content, onChange, onSave, onSwitchToCode }: VisualEditorProps) {
  const [lines, setLines] = useState<string[]>(() => content.split("\n"));
  const [activeLine, setActiveLine] = useState<number>(0);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isInternalChange = useRef(false);

  // Sync external content changes
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    setLines(content.split("\n"));
  }, [content]);

  const preambleEnd = lines.findIndex((l) => l.includes("\\begin{document}"));

  // Detect multi-line math blocks
  const mathBlocks = useMemo(() => findMathBlocks(lines), [lines]);

  // Find which math block the cursor is in (if any)
  const activeMathBlock = useMemo(() => {
    return mathBlocks.find(b => activeLine >= b.startLine && activeLine <= b.endLine) ?? null;
  }, [mathBlocks, activeLine]);

  const syncLines = useCallback(
    (newLines: string[]) => {
      setLines(newLines);
      isInternalChange.current = true;
      onChange(newLines.join("\n"));
    },
    [onChange]
  );

  const handleInput = useCallback(
    (idx: number) => {
      const el = lineRefs.current[idx];
      if (!el) return;
      const text = el.innerText.replace(/\n/g, "");
      const newLines = [...lines];
      newLines[idx] = text;
      syncLines(newLines);
    },
    [lines, syncLines]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, idx: number) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const el = lineRefs.current[idx];
        if (!el) return;
        const sel = window.getSelection();
        let offset = 0;
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const preRange = range.cloneRange();
          preRange.selectNodeContents(el);
          preRange.setEnd(range.startContainer, range.startOffset);
          offset = preRange.toString().length;
        }
        const currentText = lines[idx];
        const before = currentText.slice(0, offset);
        const after = currentText.slice(offset);
        const newLines = [...lines];
        newLines.splice(idx, 1, before, after);
        syncLines(newLines);
        setActiveLine(idx + 1);
        setTimeout(() => {
          const next = lineRefs.current[idx + 1];
          if (next) {
            next.focus();
            const range = document.createRange();
            range.setStart(next, 0);
            range.collapse(true);
            const sel2 = window.getSelection();
            sel2?.removeAllRanges();
            sel2?.addRange(range);
          }
        }, 0);
        return;
      }

      if (e.key === "Backspace" && idx > 0) {
        const el = lineRefs.current[idx];
        if (!el) return;
        const sel = window.getSelection();
        let atStart = false;
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const preRange = range.cloneRange();
          preRange.selectNodeContents(el);
          preRange.setEnd(range.startContainer, range.startOffset);
          atStart = preRange.toString().length === 0;
        }
        if (atStart) {
          e.preventDefault();
          const prevLen = lines[idx - 1].length;
          const newLines = [...lines];
          newLines.splice(idx - 1, 2, lines[idx - 1] + lines[idx]);
          syncLines(newLines);
          setActiveLine(idx - 1);
          setTimeout(() => {
            const prev = lineRefs.current[idx - 1];
            if (prev) {
              prev.focus();
              const textNode = prev.firstChild;
              if (textNode) {
                const range = document.createRange();
                const clampedOffset = Math.min(prevLen, textNode.textContent?.length ?? 0);
                range.setStart(textNode, clampedOffset);
                range.collapse(true);
                const sel2 = window.getSelection();
                sel2?.removeAllRanges();
                sel2?.addRange(range);
              }
            }
          }, 0);
        }
      }
    },
    [lines, syncLines, onSave]
  );

  const wrapSelection = useCallback(
    (prefix: string, suffix: string) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const selected = sel.toString();
      document.execCommand("insertText", false, `${prefix}${selected}${suffix}`);
    },
    []
  );

  const insertAtCursor = useCallback((text: string) => {
    document.execCommand("insertText", false, text);
  }, []);

  return (
    <div className="visual-editor">
      <div className="ve-toolbar">
        <button className="ve-toolbar-btn" onMouseDown={(e) => { e.preventDefault(); wrapSelection("\\textbf{", "}"); }}>Bold</button>
        <button className="ve-toolbar-btn" onMouseDown={(e) => { e.preventDefault(); wrapSelection("\\textit{", "}"); }}>Italic</button>
        <button className="ve-toolbar-btn" onMouseDown={(e) => { e.preventDefault(); insertAtCursor("\\section{}"); }}>Section</button>
        <button className="ve-toolbar-btn" onMouseDown={(e) => { e.preventDefault(); insertAtCursor("\\subsection{}"); }}>Subsection</button>
        <button className="ve-toolbar-btn" onClick={onSwitchToCode}>Code</button>
      </div>
      <div className="ve-lines">
        {lines.map((line, idx) => {
          const isPreamble = preambleEnd !== -1 && idx < preambleEnd;
          const headingClass = getLineHeadingClass(line);
          const isActive = activeLine === idx;
          const inMathBlock = mathBlocks.some(b => idx >= b.startLine && idx <= b.endLine);
          const lineClass = [
            "ve-line",
            isActive ? "ve-line-active" : "",
            isPreamble ? "ve-line-preamble" : "",
            inMathBlock && activeMathBlock && idx >= activeMathBlock.startLine && idx <= activeMathBlock.endLine ? "ve-line-math-active" : "",
            headingClass,
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={idx} className={lineClass}>
              <span className="ve-line-number">{idx + 1}</span>
              <div
                ref={(el) => { lineRefs.current[idx] = el; }}
                className="ve-line-text"
                contentEditable
                suppressContentEditableWarning
                onFocus={() => setActiveLine(idx)}
                onInput={() => handleInput(idx)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                dangerouslySetInnerHTML={{ __html: tokensToHtml(line) }}
              />
            </div>
          );
        })}
      </div>
      {activeMathBlock && (() => {
        const rendered = renderMathToken(activeMathBlock.tex, activeMathBlock.displayMode);
        if (!rendered) return null;
        return (
          <div className="ve-math-preview">
            <div className="ve-math-preview-label">Preview</div>
            <div
              className="ve-math-preview-content"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          </div>
        );
      })()}
    </div>
  );
}
