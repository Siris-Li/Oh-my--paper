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
  const paddingLeft = 16 + depth * 14;
  const isActive = node.path === activeFile;

  if (node.kind === "directory") {
    return (
      <>
        <div className="tree-row tree-dir" style={{ paddingLeft }}>
          <span className="tree-icon">▸</span>
          <span>{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <TreeNode key={child.id} node={child} activeFile={activeFile} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
      </>
    );
  }

  return (
    <button
      className={`tree-row tree-file ${isActive ? "is-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => onOpenFile(node.path)}
      type="button"
    >
      <span className="tree-icon">{node.kind === "asset" ? "◫" : "∙"}</span>
      <span>{node.name}</span>
    </button>
  );
}

export function ProjectTree({ nodes, activeFile, onOpenFile }: ProjectTreeProps) {
  return (
    <div className="panel project-tree">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Project</p>
          <h2>Workspace Files</h2>
        </div>
      </div>
      <div className="tree-list">
        {nodes.map((node) => (
          <TreeNode key={node.id} node={node} activeFile={activeFile} depth={0} onOpenFile={onOpenFile} />
        ))}
      </div>
    </div>
  );
}
