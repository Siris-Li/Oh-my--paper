import { useEffect, useMemo, useState } from "react";

import type { OutlineNode } from "../lib/outline";

interface OutlineTreeProps {
  nodes: OutlineNode[];
  activeId?: string;
  onSelectNode: (node: OutlineNode) => void;
}

function collectAncestorIds(nodes: OutlineNode[], targetId?: string, trail: string[] = []): string[] {
  if (!targetId) {
    return [];
  }

  for (const node of nodes) {
    if (node.id === targetId) {
      return trail;
    }
    const childTrail = collectAncestorIds(node.children, targetId, [...trail, node.id]);
    if (childTrail.length) {
      return childTrail;
    }
  }

  return [];
}

function OutlineBranch({
  node,
  depth,
  activeId,
  collapsedIds,
  sectionNumbers,
  onToggle,
  onSelectNode,
}: {
  node: OutlineNode;
  depth: number;
  activeId?: string;
  collapsedIds: Set<string>;
  sectionNumbers: Map<string, string>;
  onToggle: (id: string) => void;
  onSelectNode: (node: OutlineNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = hasChildren && collapsedIds.has(node.id);
  const isActive = node.id === activeId;

  return (
    <>
      <div
        className={`list-item outline-item ${isActive ? "is-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelectNode(node)}
      >
        <button
          type="button"
          className={`outline-caret ${hasChildren ? "" : "is-placeholder"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) {
              onToggle(node.id);
            }
          }}
          aria-label={hasChildren ? (isCollapsed ? "展开章节" : "折叠章节") : "无子章节"}
        >
          {hasChildren ? (isCollapsed ? "▸" : "▾") : "·"}
        </button>
        <div className="outline-copy">
          <div className="outline-title">
            {sectionNumbers.get(node.id) && (
              <span className="outline-section-num">{sectionNumbers.get(node.id)}&nbsp;</span>
            )}
            {node.heading.title}
          </div>
          <div className="outline-meta">
            {node.heading.filePath}:{node.heading.line}
          </div>
        </div>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <OutlineBranch
            key={child.id}
            node={child}
            depth={depth + 1}
            activeId={activeId}
            collapsedIds={collapsedIds}
            sectionNumbers={sectionNumbers}
            onToggle={onToggle}
            onSelectNode={onSelectNode}
          />
        ))}
    </>
  );
}

function collectAllIds(nodeList: OutlineNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodeList) {
    if (node.children.length > 0) {
      ids.push(node.id);
      ids.push(...collectAllIds(node.children));
    }
  }
  return ids;
}

function computeSectionNumbers(nodeList: OutlineNode[], prefix = ""): Map<string, string> {
  const map = new Map<string, string>();
  nodeList.forEach((node, index) => {
    const num = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    map.set(node.id, num);
    for (const [id, childNum] of computeSectionNumbers(node.children, num)) {
      map.set(id, childNum);
    }
  });
  return map;
}

export function OutlineTree({ nodes, activeId, onSelectNode }: OutlineTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(collectAllIds(nodes)));
  const sectionNumbers = useMemo(() => computeSectionNumbers(nodes), [nodes]);

  const ancestorIds = useMemo(() => collectAncestorIds(nodes, activeId), [activeId, nodes]);

  useEffect(() => {
    if (!ancestorIds.length) {
      return;
    }

    setCollapsedIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of ancestorIds) {
        if (next.delete(id)) {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [ancestorIds]);

  function toggleNode(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!nodes.length) {
    return <div className="text-subtle text-sm" style={{ padding: "12px 8px" }}>未找到章节结构</div>;
  }

  return (
    <div style={{ padding: "4px 0" }}>
      {nodes.map((node) => (
        <OutlineBranch
          key={node.id}
          node={node}
          depth={0}
          activeId={activeId}
          collapsedIds={collapsedIds}
          sectionNumbers={sectionNumbers}
          onToggle={toggleNode}
          onSelectNode={onSelectNode}
        />
      ))}
    </div>
  );
}
