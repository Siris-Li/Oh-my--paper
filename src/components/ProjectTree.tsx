import type { ProjectNode } from "../types";

interface ProjectTreeProps {
  nodes: ProjectNode[];
  activeFile: string;
  onOpenFile: (path: string) => void;
}

function TreeNode({
  node,
  activeFile,
  depth,
  onOpenFile,
}: {
  node: ProjectNode;
  activeFile: string;
  depth: number;
  onOpenFile: (path: string) => void;
}) {
  const paddingLeft = 8 + depth * 12;
  const isActive = node.path === activeFile;

  if (node.kind === "directory") {
    return (
      <>
        <div className="list-item" style={{ paddingLeft }}>
          <span className="list-item-icon">▾</span>
          <span>{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <TreeNode key={child.id} node={child} activeFile={activeFile} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
      </>
    );
  }

  return (
    <div
      className={`list-item ${isActive ? "is-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => onOpenFile(node.path)}
    >
      <span className="list-item-icon">{node.kind === "asset" ? "🖼" : "📄"}</span>
      <span>{node.name}</span>
    </div>
  );
}

export function ProjectTree({ nodes, activeFile, onOpenFile }: ProjectTreeProps) {
  return (
    <div style={{ padding: "0 8px" }}>
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} activeFile={activeFile} depth={0} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}
