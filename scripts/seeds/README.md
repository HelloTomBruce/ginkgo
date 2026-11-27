# 本地数据库 Seed

`config/datasources.json` 默认指向本机 Postgres 的 4 个库（**存储根**下 `config/` 可改）：

| 库名 | 领域 | Seed 脚本 |
| --- | --- | --- |
| `ginkgo_analytics` | 销售分析 | 无（首次使用时由平台「缺表自动建」生成示例表） |
| `ginkgo_saas` | B2B SaaS 订阅与留存 | `seed_saas.sql` |
| `ginkgo_ecommerce` | 电商履约交易 | `seed_ecommerce.sql` |
| `ginkgo_devops` | 研发效能 DORA | `seed_devops.sql` |

## 建库与灌数据

```bash
# 1) 建库（seed 脚本只建表，不建库）
for db in ginkgo_analytics ginkgo_saas ginkgo_ecommerce ginkgo_devops; do
  createdb -h localhost "$db"
done

# 2) 灌数据
psql -h localhost -d ginkgo_saas     -f scripts/seeds/seed_saas.sql
psql -h localhost -d ginkgo_ecommerce -f scripts/seeds/seed_ecommerce.sql
psql -h localhost -d ginkgo_devops    -f scripts/seeds/seed_devops.sql
```

## 验证

启动 dev 后 `GET /api/datasources` 的 `health` 段应全部 `"ok": true`：

```bash
curl -s localhost:3006/api/datasources | jq '.health'
```

## 运行时资产清单（改名/迁移时记得核对）

代码改名（如 openui → ginkgo）**不会**自动带动这些运行时资产，需逐一核对：

- [ ] 本地 Postgres 库名（本文档的 4 个库）
- [ ] 存储根 `config/*.json`（datasources / apps / mcp-servers / cross-source-map）
- [ ] 存储根 `data/`（sessions / dashboards / files / workspaces）
- [ ] `.next` 缓存（改名后 Turbopack chunk 里固化的绝对路径会失效，`pnpm dev:clean`）
- [ ] 本机已登录的外部 CLI（zentao / claude-design 等，凭据与项目名无关但需重登验证）
