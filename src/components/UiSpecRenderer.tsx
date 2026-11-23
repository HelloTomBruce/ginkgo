"use client";

/**
 * 平台渲染引擎薄壳：实现已上移至 @ginkgo/components（平台渲染层），
 * 客户端本地工具经 ChatDashboard 根部挂载的 <UiSpecToolProvider> 注入。
 * 保留此文件以稳定宿主侧 import 路径。
 */
export { UiSpecRenderer } from "@ginkgo/components";
