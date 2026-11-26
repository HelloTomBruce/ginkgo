/**
 * 工作区文件树：数据契约与纯组装函数（与渲染解耦，供 ArtifactViewer 与测试共用）。
 */

export interface WorkspaceFileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt: number;
  children: FileTreeNode[];
}

/**
 * 将平铺的工作区文件列表组装为嵌套层级树，并进行目录在前、字母升序排列
 */
export function buildFileTree(items: WorkspaceFileItem[]): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = [];
  const nodeMap = new Map<string, FileTreeNode>();

  for (const item of items) {
    nodeMap.set(item.path, {
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
      updatedAt: item.updatedAt,
      children: [],
    });
  }

  for (const item of items) {
    const parts = item.path.split("/");
    if (parts.length === 1) {
      const node = nodeMap.get(item.path)!;
      if (!rootNodes.some((r) => r.path === node.path)) {
        rootNodes.push(node);
      }
    } else {
      let currentPath = "";
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        const nextPath = currentPath ? `${currentPath}/${seg}` : seg;
        if (!nodeMap.has(nextPath)) {
          const dirNode: FileTreeNode = {
            name: seg,
            path: nextPath,
            type: "directory",
            updatedAt: Date.now(),
            children: [],
          };
          nodeMap.set(nextPath, dirNode);
          if (i === 0) {
            rootNodes.push(dirNode);
          } else {
            const parentNode = nodeMap.get(currentPath);
            if (parentNode && !parentNode.children.some((c) => c.path === nextPath)) {
              parentNode.children.push(dirNode);
            }
          }
        } else if (i === 0 && !rootNodes.some((r) => r.path === nextPath)) {
          rootNodes.push(nodeMap.get(nextPath)!);
        }
        currentPath = nextPath;
      }

      const parentNode = nodeMap.get(currentPath);
      const currentNode = nodeMap.get(item.path)!;
      if (parentNode && !parentNode.children.some((c) => c.path === item.path)) {
        parentNode.children.push(currentNode);
      }
    }
  }

  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
    for (const n of nodes) {
      if (n.children.length > 0) {
        sortNodes(n.children);
      }
    }
  }

  sortNodes(rootNodes);
  return rootNodes;
}
