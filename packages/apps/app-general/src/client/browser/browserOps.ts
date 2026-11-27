/**
 * 浏览器操作流水：数据契约 + 纯函数（从会话消息还原 browser_* 工具时间线）。
 * 与渲染解耦，供 BrowserView 与 ArtifactViewer（Tab 徽标计数）共用。
 */
import {
  Globe,
  Camera,
  MousePointerClick,
  Keyboard,
  Download,
  Wifi,
  Search,
  Layers,
  AlertCircle,
} from "lucide-react";
import type { AppWorkspaceMessage, AppWorkspaceToolInvocation } from "@ginkgolab/app-sdk";

export interface BrowserOperationItem {
  id: string;
  toolName: string;
  label: string;
  args?: Record<string, unknown>;
  result?: unknown;
  state: "call" | "result";
  url?: string;
  title?: string;
  what?: string;
  selector?: string;
  screenshotPath?: string;
  timestamp: number;
}

export function getBrowserToolMeta(toolName: string) {
  switch (toolName) {
    case "browser_open":
      return { label: "打开网页", icon: Globe, color: "text-brand-fg" };
    case "browser_click":
      return { label: "点击元素", icon: MousePointerClick, color: "text-info-fg" };
    case "browser_type":
      return { label: "输入文本", icon: Keyboard, color: "text-warning-fg" };
    case "browser_press":
      return { label: "按键交互", icon: Keyboard, color: "text-warning-fg" };
    case "browser_snapshot":
      return { label: "页面快照", icon: Search, color: "text-indigo-fg" };
    case "browser_screenshot":
      return { label: "网页截图", icon: Camera, color: "text-success-fg" };
    case "browser_find":
      return { label: "查找定位", icon: Search, color: "text-info-fg" };
    case "browser_network":
      return { label: "网络捕获", icon: Wifi, color: "text-purple-fg" };
    case "browser_download":
      return { label: "文件下载", icon: Download, color: "text-brand-fg" };
    case "browser_form_fill":
      return { label: "表单填充", icon: Layers, color: "text-warning-fg" };
    case "browser_close":
      return { label: "关闭会话", icon: AlertCircle, color: "text-danger-fg" };
    default:
      return { label: toolName.replace(/^browser_/, ""), icon: Globe, color: "text-foreground-subtle" };
  }
}

/** 将工作区内文件路径转换为 /api/workspace 原始文件体 URL（截图预览/下载共用） */
export function buildRawFileUrl(
  appId: string,
  sid: string,
  filePath: string,
  cacheBust?: number
): string {
  const base =
    `/api/workspace?appId=${encodeURIComponent(appId)}` +
    `&sessionId=${encodeURIComponent(sid)}` +
    `&filePath=${encodeURIComponent(filePath)}&raw=true`;
  return cacheBust ? `${base}&t=${cacheBust}` : base;
}

/** 归一化消息创建时间（AI SDK 运行时为 Date，持久化后多为字符串/时间戳） */
function resolveMessageTimestamp(createdAt: AppWorkspaceMessage["createdAt"]): number {
  if (typeof createdAt === "number") return createdAt;
  if (createdAt) {
    const ts = new Date(createdAt).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  return Date.now();
}

/** 收集单条消息承载的全部工具调用（parts 优先，回退顶层 toolInvocations） */
function invocationsOf(msg: AppWorkspaceMessage): AppWorkspaceToolInvocation[] {
  if (Array.isArray(msg.parts) && msg.parts.length > 0) {
    const out: AppWorkspaceToolInvocation[] = [];
    for (const part of msg.parts) {
      if (part && part.type === "tool-invocation" && part.toolInvocation) {
        out.push(part.toolInvocation);
      }
    }
    return out;
  }
  return Array.isArray(msg.toolInvocations) ? [...msg.toolInvocations] : [];
}

/**
 * 流式热路径的廉价提取签名：只扫末条消息（历史消息在流式期间不可变）。
 * 覆盖流式的全部常规形态——新消息到达（length/id）、末条追加调用（调用数）、
 * 调用完成（state 翻转 / result 到位）。已知盲区：历史消息的就地变更不触发
 * 重算，由流式结束对账（isStreaming true→false 刷新服务端流水）保证最终一致。
 */
export function messagesExtractionSignature(msgs: AppWorkspaceMessage[]): string {
  if (!Array.isArray(msgs) || msgs.length === 0) return "empty";
  const last = msgs[msgs.length - 1];
  const invocations = invocationsOf(last);
  const lastInv = invocations[invocations.length - 1];
  const lastState = lastInv ? String(lastInv.state ?? "-") : "-";
  const lastResult = lastInv
    ? lastInv.result === undefined
      ? "no-result"
      : "has-result"
    : "-";
  return [msgs.length, last.id ?? "-", invocations.length, lastState, lastResult].join("|");
}

/**
 * 从会话消息列表中提取所有 browser_* 工具调用，还原为时间线操作序列并做严格去重
 */
export function extractBrowserOperations(msgs: AppWorkspaceMessage[]): BrowserOperationItem[] {
  const ops: BrowserOperationItem[] = [];
  const seenToolCallIds = new Set<string>();

  for (const msg of msgs) {
    const rawInvocations = invocationsOf(msg);

    for (const inv of rawInvocations) {
      if (inv?.toolName && String(inv.toolName).startsWith("browser_")) {
        // 兜底 id 由消息 id + 序号派生，保证相同输入重算时身份稳定（不随渲染漂移）
        const callId = inv.toolCallId || `op-${msg.id ?? "msg"}-${ops.length}`;
        if (seenToolCallIds.has(callId)) {
          continue;
        }
        seenToolCallIds.add(callId);

        const args = inv.args || {};
        const res = inv.result;
        const resObj = res && typeof res === "object" ? (res as Record<string, unknown>) : null;

        let shotPath: string | undefined;
        if (inv.toolName === "browser_screenshot" && resObj) {
          const rawPath =
            typeof resObj.path === "string"
              ? resObj.path
              : typeof resObj.filePath === "string"
              ? resObj.filePath
              : typeof resObj.screenshotPath === "string"
              ? resObj.screenshotPath
              : undefined;
          if (rawPath) {
            const m = rawPath.match(/(screenshots\/[^/\\]+\.(?:png|jpg|jpeg|webp|gif))$/i);
            shotPath = m ? m[1] : `screenshots/${rawPath.replace(/^.*[/\\]/, "")}`;
          }
        }
        const url =
          typeof args.url === "string"
            ? args.url
            : resObj && typeof resObj.url === "string"
            ? resObj.url
            : resObj && typeof resObj.currentUrl === "string"
            ? resObj.currentUrl
            : undefined;
        const title = resObj && typeof resObj.title === "string" ? resObj.title : undefined;
        const what =
          typeof args.what === "string"
            ? args.what
            : typeof args.selector === "string"
            ? args.selector
            : undefined;

        ops.push({
          id: callId,
          toolName: inv.toolName,
          label: getBrowserToolMeta(inv.toolName).label,
          args,
          result: res,
          state: inv.state === "result" || res !== undefined ? "result" : "call",
          url,
          title,
          what,
          screenshotPath: shotPath,
          timestamp: resolveMessageTimestamp(msg.createdAt),
        });
      }
    }
  }

  return ops;
}
