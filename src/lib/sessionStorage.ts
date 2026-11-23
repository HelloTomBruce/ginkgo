import type { Message } from "@ai-sdk/react";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** 会话启用的数据源 id；undefined = 全选（跟随全局启用项） */
  enabledSources?: string[];
}

const STORAGE_SESSIONS_KEY = "ginkgo_chat_sessions_v1";
const STORAGE_CURRENT_SESSION_ID_KEY = "ginkgo_current_session_id_v1";

/**
 * @deprecated v2 起会话由服务端存储（/api/sessions），本模块仅保留：
 * DEFAULT_WELCOME_MESSAGE / generateSessionTitle 等纯函数，以及供
 * sessionApi.migrateLegacySessions 一次性迁移读取的旧键访问。
 * 新代码请勿再读写 localStorage 会话键。
 */
export const LEGACY_STORAGE_KEYS = [
  STORAGE_SESSIONS_KEY,
  STORAGE_CURRENT_SESSION_ID_KEY,
] as const;

/** 迁移成功后清除旧 localStorage 会话键（幂等） */
export function clearLegacySessions(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

/**
 * 兜底欢迎语（领域中立占位）：仅当应用未提供 client.welcomeMessage 时使用——
 * welcomeMessage 是 defineApp 必填项，正常路径永远走应用自治欢迎语，
 * 本兜底只防御 registry 异常形态，不承载任何应用领域宣称。
 */
export function buildWelcomeMessage(): Message {
  return {
    id: "welcome",
    role: "assistant",
    content: "👋 你好！我是本平台的智能助手，有什么可以帮你的？",
  };
}

/** 首屏初始占位（领域中立），进入会话后被应用欢迎语覆盖 */
export const DEFAULT_WELCOME_MESSAGE: Message = buildWelcomeMessage();

/**
 * 读取所有历史会话
 */
export function getSavedSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return [];
  } catch (err) {
    console.error("Failed to load sessions from localStorage:", err);
    return [];
  }
}

/**
 * 写入保存所有会话
 */
export function persistSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to save sessions to localStorage:", err);
  }
}

/**
 * 获取当前活跃会话 ID
 */
export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_CURRENT_SESSION_ID_KEY);
}

/**
 * 设置当前活跃会话 ID
 */
export function setActiveSessionId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_CURRENT_SESSION_ID_KEY, id);
}

/**
 * 根据首条用户消息生成直观简洁的会话标题
 */
export function generateSessionTitle(firstUserContent: string): string {
  if (!firstUserContent) return "新分析会话";
  // 过滤掉 markdown 或前缀标签
  const clean = firstUserContent
    .replace(/[#*`_~]/g, "")
    .replace(/^【.*?】/, "")
    .trim();
  if (!clean) return "新分析会话";
  return clean.length > 20 ? `${clean.slice(0, 20)}...` : clean;
}

/**
 * 纯函数：返回带（或去掉）enabledSources 的会话副本；undefined 删除字段恢复全选语义。
 * useSessionManager 与存储层写入共用，保证两处语义一致。
 */
export function applyEnabledSources(
  session: ChatSession,
  ids: string[] | undefined
): ChatSession {
  const copy = { ...session };
  if (ids === undefined) {
    delete copy.enabledSources;
    return copy;
  }
  copy.enabledSources = ids;
  return copy;
}

/**
 * 存储层写入指定会话的 enabledSources（undefined 恢复全选）；未知 id 静默返回。
 */
export function setSessionEnabledSources(
  sessionId: string,
  ids: string[] | undefined
): void {
  if (typeof window === "undefined") return;
  const sessions = getSavedSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  sessions[idx] = applyEnabledSources(sessions[idx], ids);
  persistSessions(sessions);
}

/**
 * 创建一个全新会话（纯工厂函数，不做持久化）。
 * 持久化由 useSessionManager 的 useEffect 单点完成，
 * 避免"每个操作各自记得落盘"造成的清空/删除后数据复活问题。
 */
export function createNewSession(customTitle?: string): ChatSession {
  const now = Date.now();
  return {
    id: `session_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: customTitle || "新建分析会话",
    createdAt: now,
    updatedAt: now,
    messages: [DEFAULT_WELCOME_MESSAGE],
  };
}
