import { io } from "next/cache";
import {
  handleListCrossSource,
  handleReplaceCrossSource,
} from "@ginkgo/app-analytics/server";
import { datasources } from "@/lib/datasources";

/**
 * GET /api/cross-source — 跨源映射设置的宿主薄壳：拆包转发到 analytics 包
 * server 编排（crossSourceRoutes），组合根注入数据源管理器单例。
 * 鉴权由 middleware 统一拦截 /api/*。
 *
 * 映射清单是同步读盘的运行时状态：cacheComponents 下不做声明的纯同步 GET
 * 会在构建期预渲染、把清单固化进静态产物，故先声明请求时 IO 再读。
 */
export async function GET() {
  await io();
  return handleListCrossSource({ sources: datasources.list() });
}

/**
 * PUT /api/cross-source — 整份替换映射清单（设置分区内的增/改/删均提交全量）。
 * 校验失败 400 + errors；落盘失败 500。
 */
export async function PUT(request: Request) {
  return handleReplaceCrossSource(request, { sources: datasources.list() });
}
