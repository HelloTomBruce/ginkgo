-- ========================================================
-- Database: openui_saas
-- Domain: B2B SaaS 订阅、客户生命周期、留存与产品使用画像
-- Components showcased: FunnelChart, RadarChart, MetricCard/Grid, GaugeProgress, SpecChart, ReactiveSimulator
-- ========================================================

DROP TABLE IF EXISTS mrr_monthly CASCADE;
DROP TABLE IF EXISTS conversion_funnel CASCADE;
DROP TABLE IF EXISTS retention_cohort CASCADE;
DROP TABLE IF EXISTS product_radar_matrix CASCADE;
DROP TABLE IF EXISTS account_segments CASCADE;

-- 1. SaaS 核心财务与增长大盘月度指标 (支持 MetricCard, SpecChart 双轴折线/面积图, GaugeProgress 达标率)
CREATE TABLE mrr_monthly (
    id SERIAL PRIMARY KEY,
    month VARCHAR(7) NOT NULL UNIQUE, -- 'YYYY-MM'
    mrr NUMERIC(12, 2) NOT NULL,
    arr NUMERIC(12, 2) NOT NULL,
    new_mrr NUMERIC(12, 2) NOT NULL,
    expansion_mrr NUMERIC(12, 2) NOT NULL,
    churn_mrr NUMERIC(12, 2) NOT NULL,
    contraction_mrr NUMERIC(12, 2) NOT NULL,
    net_revenue_retention_pct NUMERIC(5, 2) NOT NULL, -- NRR
    customer_churn_rate_pct NUMERIC(4, 2) NOT NULL,
    cac_usd NUMERIC(10, 2) NOT NULL,
    ltv_usd NUMERIC(10, 2) NOT NULL,
    ltv_cac_ratio NUMERIC(5, 2) NOT NULL,
    paying_customers INT NOT NULL,
    arpu_usd NUMERIC(10, 2) NOT NULL,
    burn_multiple NUMERIC(4, 2) NOT NULL
);

INSERT INTO mrr_monthly (
    month, mrr, arr, new_mrr, expansion_mrr, churn_mrr, contraction_mrr,
    net_revenue_retention_pct, customer_churn_rate_pct, cac_usd, ltv_usd, ltv_cac_ratio,
    paying_customers, arpu_usd, burn_multiple
) VALUES
('2026-01', 125000.00, 1500000.00, 18500.00, 9200.00,  3100.00, 1200.00, 107.5, 2.30, 1480.00,  9800.00,  6.62, 312, 400.64, 1.45),
('2026-02', 138400.00, 1660800.00, 21000.00, 10400.00, 2800.00, 1100.00, 108.9, 2.10, 1420.00, 10500.00,  7.39, 345, 401.16, 1.38),
('2026-03', 156200.00, 1874400.00, 24800.00, 12600.00, 2500.00,  900.00, 111.2, 1.90, 1380.00, 11400.00,  8.26, 382, 408.90, 1.25),
('2026-04', 178500.00, 2142000.00, 29200.00, 15100.00, 2200.00,  800.00, 112.8, 1.75, 1310.00, 12300.00,  9.39, 428, 417.06, 1.15),
('2026-05', 204800.00, 2457600.00, 34500.00, 17800.00, 2100.00,  700.00, 114.1, 1.60, 1260.00, 13200.00, 10.48, 482, 424.90, 1.05),
('2026-06', 236000.00, 2832000.00, 41000.00, 21200.00, 1900.00,  600.00, 115.6, 1.45, 1210.00, 14100.00, 11.65, 545, 433.03, 0.95),
('2026-07', 272400.00, 3268800.00, 47800.00, 24500.00, 1800.00,  500.00, 116.8, 1.32, 1150.00, 15000.00, 13.04, 618, 440.78, 0.88),
('2026-08', 314000.00, 3768000.00, 54200.00, 28600.00, 1600.00,  400.00, 117.9, 1.22, 1100.00, 15900.00, 14.45, 702, 447.29, 0.81),
('2026-09', 362500.00, 4350000.00, 62100.00, 32800.00, 1500.00,  400.00, 118.8, 1.15, 1040.00, 16600.00, 15.96, 796, 455.40, 0.74),
('2026-10', 418000.00, 5016000.00, 71500.00, 37500.00, 1300.00,  300.00, 119.5, 1.08,  980.00, 17500.00, 17.86, 908, 460.35, 0.68);

-- 2. 增长转化全流程漏斗 (直接适配 FunnelChart，各阶段转化率与流失率)
CREATE TABLE conversion_funnel (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(50) NOT NULL,
    stage_id INT NOT NULL,
    stage_name VARCHAR(50) NOT NULL,
    visitors INT NOT NULL,
    conversion_rate_pct NUMERIC(5, 2) NOT NULL,
    dropoff_rate_pct NUMERIC(5, 2) NOT NULL,
    avg_cycle_days NUMERIC(4, 1) NOT NULL
);

INSERT INTO conversion_funnel (channel, stage_id, stage_name, visitors, conversion_rate_pct, dropoff_rate_pct, avg_cycle_days) VALUES
-- 全渠道汇总
('全渠道', 1, '1. 官网独立访客',   125000, 100.00,  0.00, 0.0),
('全渠道', 2, '2. 注册免费试用',    28750,  23.00, 77.00, 0.5),
('全渠道', 3, '3. 完成核心引导',    17250,  60.00, 40.00, 1.8),
('全渠道', 4, '4. 达到高频活跃',    10350,  60.00, 40.00, 5.2),
('全渠道', 5, '5. 商务沟通/POC',    5175,  50.00, 50.00, 12.0),
('全渠道', 6, '6. 正式签约付费',    2588,  50.00, 50.00, 24.5),

-- 自然搜索裂变渠道 (高意向、高留存)
('自然裂变', 1, '1. 官网独立访客',   58000, 100.00,  0.00, 0.0),
('自然裂变', 2, '2. 注册免费试用',   16240,  28.00, 72.00, 0.3),
('自然裂变', 3, '3. 完成核心引导',   11368,  70.00, 30.00, 1.2),
('自然裂变', 4, '4. 达到高频活跃',    7957,  70.00, 30.00, 4.0),
('自然裂变', 5, '5. 商务沟通/POC',    4376,  55.00, 45.00, 9.5),
('自然裂变', 6, '6. 正式签约付费',    2407,  55.00, 45.00, 18.0),

-- 付费广告投放 (高流量、中转化)
('付费广告', 1, '1. 官网独立访客',   67000, 100.00,  0.00, 0.0),
('付费广告', 2, '2. 注册免费试用',   12510,  18.67, 81.33, 0.8),
('付费广告', 3, '3. 完成核心引导',    5882,  47.02, 52.98, 2.5),
('付费广告', 4, '4. 达到高频活跃',    2393,  40.68, 59.32, 6.8),
('付费广告', 5, '5. 商务沟通/POC',     799,  33.39, 66.61, 15.0),
('付费广告', 6, '6. 正式签约付费',     181,  22.65, 77.35, 32.0);

-- 3. 客户月度留存 Cohort 表 (支持热力表格与留存衰减折线)
CREATE TABLE retention_cohort (
    cohort_month VARCHAR(7) PRIMARY KEY,
    initial_users INT NOT NULL,
    m0_pct NUMERIC(5, 1) DEFAULT 100.0,
    m1_pct NUMERIC(5, 1),
    m2_pct NUMERIC(5, 1),
    m3_pct NUMERIC(5, 1),
    m4_pct NUMERIC(5, 1),
    m5_pct NUMERIC(5, 1),
    m6_pct NUMERIC(5, 1)
);

INSERT INTO retention_cohort (cohort_month, initial_users, m0_pct, m1_pct, m2_pct, m3_pct, m4_pct, m5_pct, m6_pct) VALUES
('2026-01', 312, 100.0, 89.5, 84.2, 81.1, 79.2, 78.0, 77.2),
('2026-02', 345, 100.0, 90.8, 86.1, 83.4, 81.5, 80.6, NULL),
('2026-03', 382, 100.0, 92.1, 88.0, 85.6, 84.1, NULL,  NULL),
('2026-04', 428, 100.0, 93.4, 89.8, 87.5, NULL,  NULL,  NULL),
('2026-05', 482, 100.0, 94.6, 91.2, NULL,  NULL,  NULL,  NULL),
('2026-06', 545, 100.0, 95.8, NULL,  NULL,  NULL,  NULL,  NULL);

-- 4. 产品能力采纳五维画像 (直接适配 RadarChart 多系列雷达图)
CREATE TABLE product_radar_matrix (
    id SERIAL PRIMARY KEY,
    dimension VARCHAR(50) NOT NULL UNIQUE,
    starter_score NUMERIC(5, 1) NOT NULL,
    pro_score NUMERIC(5, 1) NOT NULL,
    enterprise_score NUMERIC(5, 1) NOT NULL,
    industry_benchmark NUMERIC(5, 1) NOT NULL
);

INSERT INTO product_radar_matrix (dimension, starter_score, pro_score, enterprise_score, industry_benchmark) VALUES
('自动化工作流 (Workflow)', 35.0, 78.5, 96.0, 65.0),
('跨部门协同协同度 (Team)',  48.0, 82.0, 94.5, 70.0),
('AI 智能体调用深度 (AI)',   25.0, 88.0, 98.5, 55.0),
('开放 API 集成率 (API)',    18.0, 64.0, 92.0, 60.0),
('数据安全与权限管控 (Sec)', 40.0, 75.0, 99.0, 72.0),
('移动端实时活跃度 (Mobile)', 55.0, 70.0, 85.0, 68.0);

-- 5. 客户分群健康度 (支持 DataTable, SpecChart 堆叠柱状图)
CREATE TABLE account_segments (
    id SERIAL PRIMARY KEY,
    segment_name VARCHAR(50) NOT NULL UNIQUE,
    customer_count INT NOT NULL,
    arr_share_pct NUMERIC(5, 2) NOT NULL,
    total_arr NUMERIC(12, 2) NOT NULL,
    avg_nrr_pct NUMERIC(5, 2) NOT NULL,
    churn_rate_pct NUMERIC(4, 2) NOT NULL,
    nps_score INT NOT NULL,
    health_status VARCHAR(20) NOT NULL
);

INSERT INTO account_segments (segment_name, customer_count, arr_share_pct, total_arr, avg_nrr_pct, churn_rate_pct, nps_score, health_status) VALUES
('标杆企业级客户 (ARR > $100K)',     24, 46.50, 2332440.00, 126.8, 0.45, 76, '优秀 (Healthy)'),
('中型规模成长客户 ($20K - $100K)',  136, 33.20, 1665312.00, 118.2, 1.10, 64, '健康 (Good)'),
('小型团队敏捷方案 ($5K - $20K)',    318, 14.80,  742368.00, 106.5, 2.30, 52, '关注 (Warning)'),
('自助小微版订阅 (< $5K)',          430,  5.50,  275880.00,  94.2, 4.80, 41, '高风险 (At Risk)');
