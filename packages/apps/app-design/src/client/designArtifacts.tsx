"use client";

import {
  Palette,
  ShieldCheck,
  FileCode,
  Layers,
  BarChart3,
} from "lucide-react";

export type DesignStudioTab = "canvas" | "data" | "system" | "files";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt?: number;
  children: FileTreeNode[];
}

/**
 * 设计产物判定断言（强制约定：仅纳管 project/ 设计产物目录下的所有有效交付物）
 * 彻底过滤工作区根目录下与设计无关的杂乱工程配置与源码文件
 */
export function isDesignArtifact(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  if (norm.startsWith(".") || norm.includes("/.") || norm.includes("node_modules/")) {
    return false;
  }
  return norm.startsWith("project/");
}

/**
 * 将平铺文件列表组装为嵌套层级树，并进行目录在前、字母升序排序
 */
export function buildFileTree(
  items: Array<{ name: string; path: string; type?: string; size?: number; updatedAt?: number }>
): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = [];
  const nodeMap = new Map<string, FileTreeNode>();

  for (const item of items) {
    nodeMap.set(item.path, {
      name: item.name || item.path.split("/").pop() || item.path,
      path: item.path,
      type: item.type === "directory" ? "directory" : "file",
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

export function getDesignFileIcon(filePath: string) {
  if (filePath.endsWith(".dc.html")) {
    return <Layers className="w-3.5 h-3.5 text-brand-fg shrink-0" />;
  }
  if (filePath.endsWith(".dashboard.html") || filePath === "dashboard.html") {
    return <BarChart3 className="w-3.5 h-3.5 text-info-fg shrink-0" />;
  }
  if (filePath.endsWith("canvas.json")) {
    return <Palette className="w-3.5 h-3.5 text-warning-fg shrink-0" />;
  }
  if (filePath.endsWith("design-system.json") || filePath.endsWith("tokens.json")) {
    return <ShieldCheck className="w-3.5 h-3.5 text-success-fg shrink-0" />;
  }
  return <FileCode className="w-3.5 h-3.5 text-foreground-subtle shrink-0" />;
}
