/**
 * RFC 6902 JSON Patch 增量编辑与变更引擎
 */

export type JsonPatchOp = "add" | "remove" | "replace" | "move" | "copy" | "test";

export interface JsonPatchOperation {
  op: JsonPatchOp;
  path: string;
  value?: unknown;
  from?: string;
}

export interface JsonPatchResult<T> {
  success: boolean;
  doc: T;
  error?: string;
  appliedCount: number;
}

/** 原型链污染危险路径段（patch 来自模型输出，按不可信输入处理） */
const FORBIDDEN_SEGMENT_RE = /^(__proto__|constructor|prototype)$/i;

/**
 * 解析 JSON Pointer 路径，如 "/widgets/w_trend/chartConfig/type" -> ["widgets", "w_trend", "chartConfig", "type"]
 * 拒绝 __proto__/constructor/prototype 段，防止经路径改写对象原型链。
 */
export function parseJsonPointer(path: string): string[] {
  if (!path || path === "/") return [];
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return clean.split("/").map((segment) => {
    const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (FORBIDDEN_SEGMENT_RE.test(decoded)) {
      throw new Error(`非法路径段（原型链保护）: [${decoded}]`);
    }
    return decoded;
  });
}

/**
 * 结构深拷贝
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    copy[k] = deepClone(v);
  }
  return copy as T;
}

/**
 * 应用一组 RFC 6902 JSON Patch 增量修改（事务性原子应用）
 */
export function applyJsonPatch<T extends object>(
  document: T,
  patches: JsonPatchOperation[]
): JsonPatchResult<T> {
  const cloned = deepClone(document);
  let appliedCount = 0;

  try {
    for (const patch of patches) {
      const segments = parseJsonPointer(patch.path);
      if (segments.length === 0) {
        // 根路径仅允许 replace（RFC 6902：整文档替换），按克隆体内容整体置换实现
        if (patch.op !== "replace") {
          throw new Error(`无效的根操作或空路径: ${patch.path}`);
        }
        if (!patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) {
          throw new Error("根路径 replace 的 value 必须是对象");
        }
        const root = cloned as Record<string, unknown>;
        for (const k of Object.keys(root)) delete root[k];
        Object.assign(root, deepClone(patch.value));
        appliedCount++;
        continue;
      }

      applySinglePatch(cloned as Record<string, unknown>, segments, patch);
      appliedCount++;
    }

    return {
      success: true,
      doc: cloned,
      appliedCount,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // 失败时回滚，返回原始文档
    return {
      success: false,
      doc: document,
      error: `Patch 应用失败 [第 ${appliedCount + 1} 项]: ${message}`,
      appliedCount,
    };
  }
}

function applySinglePatch(
  root: Record<string, unknown>,
  segments: string[],
  patch: JsonPatchOperation
): void {
  const lastKey = segments[segments.length - 1];
  let curr: unknown = root;

  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    if (curr === null || typeof curr !== "object") {
      throw new Error(`路径不可达: 无法在非对象上索引 [${key}]`);
    }
    const currRecord = curr as Record<string, unknown>;
    if (!(key in currRecord)) {
      if (patch.op === "add") {
        currRecord[key] = {};
      } else {
        throw new Error(`路径不存在: [${key}]`);
      }
    }
    curr = currRecord[key];
  }

  if (curr === null || typeof curr !== "object") {
    throw new Error(`父节点无效`);
  }

  const parent = curr as Record<string, unknown>;

  switch (patch.op) {
    case "replace": {
      if (Array.isArray(parent)) {
        const idx = Number(lastKey);
        if (Number.isNaN(idx) || idx < 0 || idx >= parent.length) {
          throw new Error(`数组索引越界: [${lastKey}]`);
        }
        parent[idx] = patch.value;
      } else {
        parent[lastKey] = patch.value;
      }
      break;
    }

    case "add": {
      if (Array.isArray(parent)) {
        if (lastKey === "-") {
          parent.push(patch.value);
        } else {
          const idx = Number(lastKey);
          // RFC 6902：索引必须是 0..length 的整数，越界即错误
          if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) {
            throw new Error(`数组索引越界: [${lastKey}]`);
          }
          parent.splice(idx, 0, patch.value);
        }
      } else {
        parent[lastKey] = patch.value;
      }
      break;
    }

    case "remove": {
      if (Array.isArray(parent)) {
        const idx = Number(lastKey);
        if (Number.isNaN(idx) || idx < 0 || idx >= parent.length) {
          throw new Error(`数组索引越界: [${lastKey}]`);
        }
        parent.splice(idx, 1);
      } else {
        delete parent[lastKey];
      }
      break;
    }

    case "test": {
      const actual = Array.isArray(parent) ? parent[Number(lastKey)] : parent[lastKey];
      if (JSON.stringify(actual) !== JSON.stringify(patch.value)) {
        throw new Error(`Test 校验失败: 期望 ${JSON.stringify(patch.value)}, 实际为 ${JSON.stringify(actual)}`);
      }
      break;
    }

    default:
      throw new Error(`暂不支持的 Patch 指令: [${patch.op}]`);
  }
}
