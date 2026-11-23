/**
 * analytics 应用包的 isomorphic 层（client-safe：零 node 依赖、零 React 依赖）。
 * 看板 DSL 的确定性变换/时间宏/快照导入导出/记录类型——宿主收藏链路与
 * analytics 服务端（物化/重放）共用同一实现。
 *
 * 注意：dashboardCapture（活看板捕获）依赖 react-lang 解析器与组件库定义，
 * 单独经 "./isomorphic/dashboardCapture" 子入口导出——不得并入本入口，
 * 否则 server 路由链（/api/dashboards → dashboardStore → 本入口）会把
 * React 客户端组件拉进服务端 bundle。
 */
export * from "./transforms";
export * from "./timeMacros";
export * from "./queryRows";
export * from "./dashboardSnapshot";
export * from "./dashboardTypes";
