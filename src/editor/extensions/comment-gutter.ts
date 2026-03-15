import { gutter, GutterMarker } from "@codemirror/view";
import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";

export const setCommentMarkers = StateEffect.define<Array<{ line: number; color: string }>>();

class CommentDot extends GutterMarker {
  color: string;
  constructor(color: string) {
    super();
    this.color = color;
  }
  override toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-comment-dot";
    dot.style.background = this.color;
    return dot;
  }
}

const commentMarkersField = StateField.define<Map<number, string>>({
  create() {
    return new Map();
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCommentMarkers)) {
        const next = new Map<number, string>();
        for (const { line, color } of effect.value) {
          next.set(line, color);
        }
        return next;
      }
    }
    return value;
  },
});

const commentGutterExtension = gutter({
  class: "cm-comment-gutter",
  markers(view) {
    const markersMap = view.state.field(commentMarkersField);
    const builder: Array<{ from: number; marker: GutterMarker }> = [];
    for (const [lineNum, color] of markersMap) {
      if (lineNum >= 1 && lineNum <= view.state.doc.lines) {
        const line = view.state.doc.line(lineNum);
        builder.push({ from: line.from, marker: new CommentDot(color) });
      }
    }
    builder.sort((a, b) => a.from - b.from);
    return RangeSet.of(builder.map((b) => b.marker.range(b.from)));
  },
});

export function commentGutter(): Extension {
  return [commentMarkersField, commentGutterExtension];
}
