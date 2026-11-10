-- ========================================================
-- Database: openui_devops
-- Domain: 研发效能平台、DORA 关键指标、CI/CD 流水线与稳定性保障
-- Components showcased: ContributionHeatmap, RadarChart, FunnelChart, ActivityTimeline, ActionPlanCard, GaugeProgress
-- ========================================================

DROP TABLE IF EXISTS daily_commit_activity CASCADE;
DROP TABLE IF EXISTS dora_team_radar CASCADE;
DROP TABLE IF EXISTS cicd_pipeline_funnel CASCADE;
DROP TABLE IF EXISTS system_incidents_timeline CASCADE;
DROP TABLE IF EXISTS engineering_action_plans CASCADE;

-- 1. 每日代码提交与交付热力数据 (专为 ContributionHeatmap 设计，覆盖 2026 年连续 300+ 天)
CREATE TABLE daily_commit_activity (
    id SERIAL PRIMARY KEY,
    activity_date DATE NOT NULL UNIQUE,
    commit_count INT NOT NULL,
    pr_merged_count INT NOT NULL,
    build_count INT NOT NULL,
    tests_run INT NOT NULL,
    lines_added INT NOT NULL,
    lines_deleted INT NOT NULL,
    active_developers INT NOT NULL
);

-- 生成 2026-01-01 至 2026-10-31 每一天的真实研发活动热力数据
INSERT INTO daily_commit_activity (
    activity_date, commit_count, pr_merged_count, build_count, tests_run, lines_added, lines_deleted, active_developers
)
SELECT
    d::date AS activity_date,
    -- 周末提交少，工作日提交活跃，并在周期内呈现自然的迭代冲刺高峰
    CASE 
        WHEN EXTRACT(DOW FROM d) IN (0, 6) THEN (RANDOM() * 8)::INT
        ELSE (25 + (EXTRACT(DOY FROM d) % 14) * 3 + (RANDOM() * 30))::INT
    END AS commit_count,
    CASE 
        WHEN EXTRACT(DOW FROM d) IN (0, 6) THEN (RANDOM() * 2)::INT
        ELSE (5 + (RANDOM() * 12))::INT
    END AS pr_merged_count,
    CASE 
        WHEN EXTRACT(DOW FROM d) IN (0, 6) THEN (RANDOM() * 15)::INT
        ELSE (60 + (RANDOM() * 80))::INT
    END AS build_count,
    CASE 
        WHEN EXTRACT(DOW FROM d) IN (0, 6) THEN (RANDOM() * 1200)::INT
        ELSE (12000 + (RANDOM() * 15000))::INT
    END AS tests_run,
    (150 + (RANDOM() * 3500))::INT AS lines_added,
    (80 + (RANDOM() * 1800))::INT AS lines_deleted,
    CASE 
        WHEN EXTRACT(DOW FROM d) IN (0, 6) THEN (RANDOM() * 6)::INT
        ELSE (28 + (RANDOM() * 18))::INT
    END AS active_developers
FROM generate_series(DATE '2026-01-01', DATE '2026-10-31', INTERVAL '1 day') AS d;

-- 2. DORA 与研发效能六维对比画像 (适配 RadarChart 多团队 / 现状 vs 行业高绩效基准)
CREATE TABLE dora_team_radar (
    id SERIAL PRIMARY KEY,
    dimension VARCHAR(50) NOT NULL UNIQUE,
    core_backend_score NUMERIC(5, 1) NOT NULL,
    frontend_infra_score NUMERIC(5, 1) NOT NULL,
    ai_platform_score NUMERIC(5, 1) NOT NULL,
    dora_elite_benchmark NUMERIC(5, 1) NOT NULL
);

INSERT INTO dora_team_radar (dimension, core_backend_score, frontend_infra_score, ai_platform_score, dora_elite_benchmark) VALUES
('部署频率 (Deployment Frequency)', 88.0, 95.0, 91.0, 95.0),
('变更前置时间 (Lead Time)',         82.5, 92.0, 85.0, 90.0),
('变更失败率 (Change Failure Rate)', 91.0, 86.5, 78.0, 92.0),
('故障恢复时间 (MTTR)',               94.0, 89.0, 83.5, 90.0),
('单测及自动化覆盖率 (Coverage)',     85.0, 76.0, 89.0, 85.0),
('依赖与漏洞修复时效 (Security SLA)',  90.0, 84.0, 92.5, 90.0);

-- 3. CI/CD 流水线逐级交付漏斗 (适配 FunnelChart，展示流水线在测试与构建中的拦截率)
CREATE TABLE cicd_pipeline_funnel (
    id SERIAL PRIMARY KEY,
    stage_id INT NOT NULL,
    stage_name VARCHAR(50) NOT NULL,
    pipeline_runs INT NOT NULL,
    pass_rate_pct NUMERIC(5, 2) NOT NULL,
    failure_rate_pct NUMERIC(5, 2) NOT NULL,
    avg_duration_minutes NUMERIC(4, 1) NOT NULL
);

INSERT INTO cicd_pipeline_funnel (stage_id, stage_name, pipeline_runs, pass_rate_pct, failure_rate_pct, avg_duration_minutes) VALUES
(1, '1. 代码 Push 触发触发器',    14200, 100.00,  0.00, 0.1),
(2, '2. 静态代码扫描 Lint/Sonar', 13780,  97.04,  2.96, 1.2),
(3, '3. 单元测试与快照比对',       12850,  93.25,  6.75, 4.5),
(4, '4. 容器镜像构建与制品打包',   12420,  96.65,  3.35, 6.2),
(5, '5. 预发布环境自动化集成验证', 11950,  96.22,  3.78, 8.0),
(6, '6. 灰度放量与全量生产部署',   11860,  99.25,  0.75, 12.5);

-- 4. 稳定性重大事件时间线 (适配 ActivityTimeline / InsightBox)
CREATE TABLE system_incidents_timeline (
    id SERIAL PRIMARY KEY,
    incident_code VARCHAR(30) NOT NULL UNIQUE,
    title VARCHAR(100) NOT NULL,
    severity VARCHAR(10) NOT NULL, -- P0, P1, P2
    service_name VARCHAR(50) NOT NULL,
    occurred_at TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP NOT NULL,
    mttr_minutes INT NOT NULL,
    affected_users_pct NUMERIC(4, 2) NOT NULL,
    root_cause_summary TEXT NOT NULL,
    postmortem_status VARCHAR(20) NOT NULL
);

INSERT INTO system_incidents_timeline (
    incident_code, title, severity, service_name, occurred_at, resolved_at,
    mttr_minutes, affected_users_pct, root_cause_summary, postmortem_status
) VALUES
('INC-2026-0912', '用户中心鉴权服务 Redis 连接池耗尽', 'P1', 'auth-service', 
 '2026-09-12 14:22:00', '2026-09-12 14:48:00', 26, 3.20, 
 '突发营销活动导致瞬时并发鉴权请求激增，连接池未开启自适应弹性扩容，造成下游请求堆积。', '已完成复盘'),

('INC-2026-0928', '账单计费队列消息堆积导致出账延迟', 'P2', 'billing-worker', 
 '2026-09-28 02:15:00', '2026-09-28 03:02:00', 47, 0.85, 
 '月末结算批量任务并发死锁重试导致 Kafka 分区消费线程挂起，已优化事务隔离级别并增加防重机制。', '已完成复盘'),

('INC-2026-1008', 'AI 知识库向量检索集群分片再平衡超时', 'P1', 'vector-retrieval', 
 '2026-10-08 19:30:00', '2026-10-08 19:54:00', 24, 4.10, 
 '索引分片热点倾斜引发单节点内存占用达阈值并触发 GC 暂停，已配置动态路由与只读从节点隔离。', '已完成复盘'),

('INC-2026-1022', '网关流量整形规则变更导致跨地域访问间歇 504', 'P0', 'api-gateway', 
 '2026-10-22 10:04:00', '2026-10-22 10:19:00', 15, 8.50, 
 '新版 Envoy 限流配置中正则回溯性能劣变，变更灰度放量拦截生效，15分钟内完成回滚。', '已完成复盘');

-- 5. 研发与系统治理行动计划清单 (适配 ActionPlanCard)
CREATE TABLE engineering_action_plans (
    id SERIAL PRIMARY KEY,
    initiative VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    priority VARCHAR(10) NOT NULL, -- P0, P1, P2
    owner VARCHAR(50) NOT NULL,
    deadline DATE NOT NULL,
    progress_pct INT NOT NULL,
    status VARCHAR(20) NOT NULL, -- '已完成', '进行中', '待排期'
    expected_impact VARCHAR(200) NOT NULL
);

INSERT INTO engineering_action_plans (
    initiative, category, priority, owner, deadline, progress_pct, status, expected_impact
) VALUES
('核心接口 P99 延迟治理专项 (<80ms)', '性能优化', 'P0', '架构组-王敏', '2026-11-15', 75, '进行中', '降低全局网关调用时延 35%，削减计算节点资源开销'),
('生产发布无人值守与金丝雀自动回滚', 'CI/CD效能', 'P0', 'SRE-李思成', '2026-11-30', 60, '进行中', '将变更失败平均止损时间从 18min 缩短至 2min 内'),
('全链路分布式链路追踪升级 OpenTelemetry', '可观测性', 'P1', '平台组-陈浩', '2026-12-15', 30, '进行中', '实现异构微服务上下文 100% 覆盖与慢调用自动定位'),
('单元测试覆盖率门禁提升至 80%', '工程质量', 'P1', '各业务线TL', '2026-12-31', 45, '进行中', '拦截 60% 以上的新增回归缺陷在 CI 阶段');
