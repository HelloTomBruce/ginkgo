import { getDefaultCrossSourceRegistry, validateMappings } from "./crossSource";
import type { CrossSourceRegistry, MappingEntry } from "./crossSource";

/**
 * /api/cross-source 厚路由的编排实现（宿主薄壳拆包转发 + 注入组合根单例）。
 * 职责边界：本模块做「入参校验 → 注册表读写 → Response 映射」；
 * 数据源描述符由宿主注入（组合根唯一装配，本包不感知宿主单例）。
 */

/** 组合根注入位（宿主薄壳传单例；测试注入临时注册表） */
export interface CrossSourceRouteDeps {
  /** 当前已配置的数据源（供界面给出源 id 建议与启用态提示） */
  sources: Array<{ id: string; name: string; enabled: boolean }>;
  /** 跨源映射注册表（缺省沿用默认单例） */
  registry?: CrossSourceRegistry;
}

/** GET / PUT 的响应体（客户端查看契约，字段裁剪到设置分区所需） */
export interface CrossSourceSettingsPayload {
  mappings: MappingEntry[];
  sources: CrossSourceRouteDeps["sources"];
  /** 跨源联合分析当前是否成立（与 /api/datasources 的 features.crossSource 同一判定） */
  active: boolean;
}

function buildPayload(deps: CrossSourceRouteDeps): CrossSourceSettingsPayload {
  const registry = deps.registry ?? getDefaultCrossSourceRegistry();
  const enabledIds = deps.sources
    .filter((s) => s.enabled)
    .map((s) => s.id);
  return {
    mappings: registry.listMappings(),
    sources: deps.sources.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
    })),
    active: registry.resolveCrossSourcePairs(enabledIds).length > 0,
  };
}

/**
 * GET /api/cross-source — 跨源映射设置分区的取数。
 * - 200 `{ mappings, sources, active }`
 */
export function handleListCrossSource(deps: CrossSourceRouteDeps): Response {
  try {
    return Response.json(buildPayload(deps));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/cross-source — 整份替换映射清单（分区内的增/改/删均提交全量清单，即时保存）。
 * - 200 `{ mappings, sources, active }`
 * - 400 请求体不是含 mappings 数组的对象，或映射校验失败（附 errors）
 * - 500 落盘失败（如配置文件不是合法 JSON）
 */
export async function handleReplaceCrossSource(
  request: Request,
  deps: CrossSourceRouteDeps
): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as {
      mappings?: unknown;
    } | null;
    if (!body || typeof body !== "object" || !("mappings" in body)) {
      return Response.json(
        { errors: ["请求体必须包含 mappings 数组"] },
        { status: 400 }
      );
    }
    const verdict = validateMappings(body.mappings);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: 400 });
    }
    const registry = deps.registry ?? getDefaultCrossSourceRegistry();
    registry.replaceMappings(verdict.mappings);
    return Response.json(buildPayload(deps));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
