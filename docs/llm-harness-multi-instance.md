# LLM Harness 多副本部署指南（WS-8）

> 适用版本：harness-maturity-v2 及以后。本文是多副本部署的**强制运维条目**文档：
> 涉及「必须」字样的配置不可省略，否则任务状态跨副本不一致。

## 1. 拓扑

```text
                ┌────────────── LB（无粘性要求）──────────────┐
                │                                             │
        ┌───────▼───────┐                             ┌───────▼───────┐
        │  Next 实例 A  │                             │  Next 实例 B  │
        │  owner: 任务X │                             │               │
        │  reader 循环  │                             │               │
        └───────┬───────┘                             └───────┬───────┘
                │                                             │
        ┌───────▼─────────────────────────────────────────────▼───────┐
        │                          Redis                              │
        └─────────────────────────────────────────────────────────────┘
```

核心语义：

- **owner 模型**：创建任务的实例持有 provider reader 循环、AbortController、看门狗与
  租约心跳；分块一边推本地订阅者一边写 Redis（list 追加 + channel 发布）。
- **任一副本可服务重连**：重连协议为「先订阅 channel、再读 list 重放、按分块序号
  （seq）去重」——订阅建立到列表读取之间发布的分块两边都有，按 seq 去重后
  **既不丢失也不双份**；LB 不需要粘性会话。
- **跨副本中止**：任何实例收到 stop 都经 `harness:control` 频道广播；owner 实例
  监听后触发本地 AbortController 并取消上游 reader（停止计费）。
- **租约与孤儿回收**：owner 注册任务后立即续租（冷启动窗口），此后按 TTL/3 周期
  刷新；任一实例的清扫器（±20% 抖动错峰）发现 running 任务租约失踪且无法证明
  owner 存活 → 诚实标记 `error: owner_lost` 并广播关闭订阅者。**不做任务接管
  迁移**：provider 流已死，假装可续是欺骗。
- **分布式准入**：`harness:running` set 计数替代进程内计数；清扫器同步对账剔除
  租约失踪成员，准入名额自动释放。

## 2. 必须配置

```bash
LLM_TASK_STORE=redis          # 必须：启用 Redis 后端
REDIS_URL=redis://host:6379   # 必须：redis 模式缺此变量工厂直接报错
LLM_INSTANCE_ID=              # 建议：稳定且唯一的实例 id（缺省 hostname:pid；
                              # 容器环境 hostname 随重启变化，建议显式注入 pod 名）
LLM_LEASE_TTL_MS=15000        # 可选：租约 TTL（心跳 = TTL/3）
LLM_SWEEP_INTERVAL_MS=30000   # 可选：清扫周期（±20% 抖动）
LLM_TASK_TIMEOUT_MS=600000    # 可选：单任务看门狗（既有）
```

**强制条目：应用层 sessionStore 必须同步换共享存储。** harness 的在途任务状态
（本指南所覆盖部分）只是会话状态的一半；会话上下文元数据（token 锚点、摘要缓存、
pendingPlan）经 `SessionContextStore` 注入，默认实现为进程内/本地文件（应用层
`src/lib/sessionStore`）。多副本部署时它必须换成共享存储（Redis hash / 数据库），
否则 token 锚点与规划工件在副本间不一致——上下文压缩判定漂移、plan→execute 交接
丢失。此项是部署验收的一部分，不是建议。

依赖形态：`ioredis` 为 **peer optional**——单进程部署（`LLM_TASK_STORE=memory|file`）
不安装不受影响；redis 模式要求目标进程已安装 `ioredis`，缺失时报含安装指引的
明确错误。

## 3. Redis 键规约

| 键 | 类型 | 用途 | TTL |
|---|---|---|---|
| `harness:task:{sessionKey}` | hash | 快照元数据（status/ownerInstanceId/…） | running 10min（心跳续期）；终态 30s |
| `harness:task:{sessionKey}:chunks` | list | base64 分块（RPUSH 返回值即 seq） | 同上 |
| `harness:chan:{sessionKey}` | pub/sub | live 分块 `{t:"c",s,d}` 与终态关闭 `{t:"e",st,m}` | — |
| `harness:control` | pub/sub | abort 广播 `{k,r}`（单频道） | — |
| `harness:lease:{sessionKey}` | string | owner instanceId | leaseTtlMs |
| `harness:running` | set | 分布式准入计数 | — |

`sessionKey = {tenantId}:{sessionId}`（WS-10 租户命名空间；缺省租户 `anon`）。

实现约束：只用基础命令（hash/list/set/string/pubsub/TTL），**不用 Lua**——
与 ioredis-mock（CI 契约测试）的行为差异面最小化。

## 4. docker-compose 本地验证

仓库根 `docker-compose.yml` 提供 redis + 双副本拓扑。验证清单：

1. `docker compose up -d redis` → redis 就绪。
2. 双副本分别监听 3006/3007，均注入 `LLM_TASK_STORE=redis`、
   `REDIS_URL=redis://redis:6379`、不同的 `LLM_INSTANCE_ID`。
3. **重连无粘性**：副本 A 发起分析 → 产出中杀掉 A 的前端连接 → 带同 sessionId
   请求副本 B 的 `POST /api/analyze?reconnect=1` → 完整重放 + 续接到终态。
4. **跨副本停止**：任务在 A 运行 → 向 B 发 `{"action":"stop","sessionId":…}` →
   A 的 provider 侧停止计费（遥测 `abort` 事件在 A 的日志）。
5. **孤儿回收**：任务在 A 运行 → `docker compose kill app-a`（模拟暴毙）→
   等 `LLM_LEASE_TTL_MS + LLM_SWEEP_INTERVAL_MS` → B 日志出现 `abort reason=timeout`
   → 重连收到 `owner_lost` 错误语义。
6. **准入名额**：并发打满 `LLM_MAX_CONCURRENT_TASKS` → 429；kill 一个副本 →
   等清扫周期 → 名额释放，新任务恢复 200。

## 5. 故障语义备忘

| 故障 | 行为 |
|---|---|
| owner 暴毙 | 清扫器标记 `owner_lost`；重连收到 error；running 名额释放 |
| Redis 不可达 | 新任务创建失败（流式报错）；在途任务的本地推送不受影响，状态持久化 best-effort 失败记 `TASK_STATUS_PERSIST_FAILED` 遥测 |
| 终态写失败 | 本地收尾（定时器/订阅者/遥测）照常完成，Redis 侧靠 TTL 自愈 |
| 分块写入磁盘满等持久化失败 | 任务 error 收尾，不产生 unhandled rejection |
