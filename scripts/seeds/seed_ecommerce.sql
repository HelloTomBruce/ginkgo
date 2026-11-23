-- ========================================================
-- Database: ginkgo_ecommerce
-- Domain: 电商全链路：交易大盘、品类渠道、店铺履约体验雷达、售后漏斗与订单明细
-- Components showcased: SpecChart, AnalyticsChart, RadarChart, FunnelChart, DataTable, MetricCard/Grid
-- ========================================================

DROP TABLE IF EXISTS monthly_sales_summary CASCADE;
DROP TABLE IF EXISTS category_performance CASCADE;
DROP TABLE IF EXISTS store_experience_radar CASCADE;
DROP TABLE IF EXISTS refund_process_funnel CASCADE;
DROP TABLE IF EXISTS orders CASCADE;

-- 1. 电商月度全渠道销售总览 (适配 MetricCard, SpecChart 双轴图: GMV + 毛利率)
CREATE TABLE monthly_sales_summary (
    id SERIAL PRIMARY KEY,
    month VARCHAR(7) NOT NULL UNIQUE,
    gmv_cny NUMERIC(14, 2) NOT NULL,
    net_sales_cny NUMERIC(14, 2) NOT NULL,
    order_count INT NOT NULL,
    paying_users INT NOT NULL,
    avg_order_value_cny NUMERIC(8, 2) NOT NULL, -- 客单价
    gross_margin_pct NUMERIC(5, 2) NOT NULL,   -- 毛利率
    refund_amount_cny NUMERIC(12, 2) NOT NULL,
    refund_rate_pct NUMERIC(4, 2) NOT NULL,
    marketing_cost_cny NUMERIC(12, 2) NOT NULL,
    roi NUMERIC(4, 2) NOT NULL
);

INSERT INTO monthly_sales_summary (
    month, gmv_cny, net_sales_cny, order_count, paying_users,
    avg_order_value_cny, gross_margin_pct, refund_amount_cny, refund_rate_pct, marketing_cost_cny, roi
) VALUES
('2026-01',  8900000.00,  8188000.00, 31200, 26800, 285.26, 42.50,  712000.00, 8.00, 1420000.00, 5.77),
('2026-02',  7600000.00,  7030000.00, 26500, 22900, 286.79, 41.80,  570000.00, 7.50, 1180000.00, 5.96),
('2026-03',  9850000.00,  9081700.00, 33800, 28900, 291.42, 43.10,  768300.00, 7.80, 1550000.00, 5.86),
('2026-04', 10400000.00,  9599200.00, 35100, 30100, 296.30, 44.00,  800800.00, 7.70, 1620000.00, 5.93),
('2026-05', 12100000.00, 11156200.00, 39800, 34200, 304.02, 44.60,  943800.00, 7.80, 1890000.00, 5.90),
('2026-06', 16800000.00, 15388800.00, 54200, 46500, 309.96, 45.80, 1411200.00, 8.40, 2750000.00, 5.60),
('2026-07', 11900000.00, 11043200.00, 38600, 33100, 308.29, 44.20,  856800.00, 7.20, 1780000.00, 6.20),
('2026-08', 13400000.00, 12448600.00, 42900, 36800, 312.35, 45.10,  951400.00, 7.10, 2020000.00, 6.16),
('2026-09', 15200000.00, 14120800.00, 47800, 41000, 318.00, 46.20, 1079200.00, 7.10, 2280000.00, 6.19),
('2026-10', 18900000.00, 17558100.00, 58400, 49800, 323.63, 47.00, 1341900.00, 7.10, 2810000.00, 6.25);

-- 2. 核心品类经营与退款交叉分析 (适配 AnalyticsChart 堆叠柱状 / 散点图)
CREATE TABLE category_performance (
    id SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE,
    ytd_gmv_cny NUMERIC(14, 2) NOT NULL,
    gmv_share_pct NUMERIC(5, 2) NOT NULL,
    yoy_growth_pct NUMERIC(5, 2) NOT NULL,
    avg_price_cny NUMERIC(8, 2) NOT NULL,
    return_rate_pct NUMERIC(4, 2) NOT NULL,
    inventory_turnover_days NUMERIC(5, 1) NOT NULL,
    repeat_purchase_rate_pct NUMERIC(4, 2) NOT NULL
);

INSERT INTO category_performance (
    category_name, ytd_gmv_cny, gmv_share_pct, yoy_growth_pct,
    avg_price_cny, return_rate_pct, inventory_turnover_days, repeat_purchase_rate_pct
) VALUES
('数码 3C & 智能穿戴', 42500000.00, 34.00, 28.5, 899.00,  5.2, 24.5, 31.8),
('品质美妆与护肤',     28700000.00, 22.96, 42.1, 328.00,  4.1, 18.2, 54.6),
('潮流服饰与箱包',     23100000.00, 18.48, 14.8, 245.00, 14.8, 42.0, 38.2),
('智能家居与生活电器', 19800000.00, 15.84, 32.0, 580.00,  6.8, 32.5, 26.4),
('户外运动与骑行露营', 10900000.00,  8.72, 68.4, 412.00,  7.5, 28.0, 41.5);

-- 3. 核心旗舰店服务履约体验五维画像 (适配 RadarChart 旗舰对比)
CREATE TABLE store_experience_radar (
    id SERIAL PRIMARY KEY,
    dimension VARCHAR(50) NOT NULL UNIQUE,
    flagship_store_score NUMERIC(5, 1) NOT NULL,
    marketplace_avg_score NUMERIC(5, 1) NOT NULL,
    competitor_top_score NUMERIC(5, 1) NOT NULL,
    sla_target NUMERIC(5, 1) NOT NULL
);

INSERT INTO store_experience_radar (dimension, flagship_store_score, marketplace_avg_score, competitor_top_score, sla_target) VALUES
('发货时效 (<24h交付揽收)', 96.5, 78.0, 92.0, 90.0),
('品质口碑与商品相符度',    94.2, 82.5, 91.0, 90.0),
('智能客服秒级应答率',      98.0, 71.0, 89.5, 95.0),
('售后极速退款体验',        92.0, 68.5, 87.0, 88.0),
('物流破损/丢件控制力',     97.8, 85.0, 94.0, 95.0),
('用户主动好评率',          91.5, 76.0, 88.0, 85.0);

-- 4. 售后逆向流转漏斗 (适配 FunnelChart 逆向退款流失及拦截)
CREATE TABLE refund_process_funnel (
    id SERIAL PRIMARY KEY,
    step_id INT NOT NULL,
    step_name VARCHAR(50) NOT NULL,
    case_count INT NOT NULL,
    conversion_rate_pct NUMERIC(5, 2) NOT NULL,
    dropoff_rate_pct NUMERIC(5, 2) NOT NULL,
    avg_duration_hours NUMERIC(4, 1) NOT NULL
);

INSERT INTO refund_process_funnel (step_id, step_name, case_count, conversion_rate_pct, dropoff_rate_pct, avg_duration_hours) VALUES
(1, '1. 买家发起退款申请', 12450, 100.00,  0.00, 0.0),
(2, '2. 智能客服/人工审核通过', 11580,  93.01,  6.99, 1.2),
(3, '3. 买家寄出/顺丰上门取件', 10420,  89.98, 10.02, 18.5),
(4, '4. 仓库收件并完成质检',   9980,  95.78,  4.22, 12.0),
(5, '5. 财务极速原路打款成功', 9910,  99.30,  0.70, 0.5);

-- 5. 真实订单交易明细 (120+ 笔订单，支持 DataTable 排序、搜索、分页与状态展示)
CREATE TABLE orders (
    order_id VARCHAR(24) PRIMARY KEY,
    created_at TIMESTAMP NOT NULL,
    channel VARCHAR(30) NOT NULL,
    customer_id VARCHAR(20) NOT NULL,
    vip_level VARCHAR(20) NOT NULL,
    category VARCHAR(50) NOT NULL,
    product_name VARCHAR(100) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    province VARCHAR(30) NOT NULL,
    order_status VARCHAR(30) NOT NULL,
    is_refunded BOOLEAN DEFAULT FALSE,
    refund_reason VARCHAR(100)
);

INSERT INTO orders (
    order_id, created_at, channel, customer_id, vip_level,
    category, product_name, amount, payment_method, province,
    order_status, is_refunded, refund_reason
) VALUES
('ORD-20261001-001', '2026-10-01 09:12:00', 'App自营', 'CUST-8901', 'SVIP黑卡', '数码 3C & 智能穿戴', 'Ultra Noise-Cancelling Pro 耳机', 1899.00, '微信支付', '广东', '已完成', FALSE, NULL),
('ORD-20261001-002', '2026-10-01 10:24:30', '抖音直播', 'CUST-4122', '普通会员', '品质美妆与护肤', '玻尿酸紧致修护精华套盒', 428.00, '抖音支付', '浙江', '已完成', FALSE, NULL),
('ORD-20261001-003', '2026-10-01 11:05:12', '微信小程序', 'CUST-7719', '金卡会员', '潮流服饰与箱包', '轻量羽绒保暖连帽外套', 699.00, '微信支付', '江苏', '已退款', TRUE, '尺码不合适'),
('ORD-20261001-004', '2026-10-01 12:40:00', 'App自营', 'CUST-3310', 'SVIP黑卡', '数码 3C & 智能穿戴', '4K 高刷专业显示器 27寸', 2499.00, '支付宝', '北京', '已完成', FALSE, NULL),
('ORD-20261001-005', '2026-10-01 14:15:22', '天猫旗舰', 'CUST-6502', '白银会员', '智能家居与生活电器', '智能变频无叶净化风扇', 899.00, '支付宝', '上海', '已完成', FALSE, NULL),
('ORD-20261001-006', '2026-10-01 15:30:10', 'App自营', 'CUST-9012', '金卡会员', '户外运动与骑行露营', '超轻折叠铝合金野营双人帐篷', 1280.00, '银联支付', '四川', '已完成', FALSE, NULL),
('ORD-20261001-007', '2026-10-01 16:22:45', '抖音直播', 'CUST-2231', '普通会员', '潮流服饰与箱包', '复古水洗做旧工装长裤', 299.00, '抖音支付', '湖北', '已退款', TRUE, '商品材质与描述不符'),
('ORD-20261001-008', '2026-10-01 17:50:00', '微信小程序', 'CUST-5891', '金卡会员', '品质美妆与护肤', '臻光透白日夜抗初老面霜', 580.00, '微信支付', '山东', '已完成', FALSE, NULL),
('ORD-20261001-009', '2026-10-01 19:10:15', 'App自营', 'CUST-1190', 'SVIP黑卡', '数码 3C & 智能穿戴', '旗舰折叠屏手机 512GB', 8999.00, '微信支付', '广东', '已完成', FALSE, NULL),
('ORD-20261001-010', '2026-10-01 20:30:40', '天猫旗舰', 'CUST-4819', '普通会员', '智能家居与生活电器', '智能洗地吸拖一体机器人', 3299.00, '花呗分期', '福建', '已退款', TRUE, '功能故障/使用不便'),
('ORD-20261002-011', '2026-10-02 08:35:10', 'App自营', 'CUST-3045', '白银会员', '户外运动与骑行露营', '碳纤维公路自行车锁踏套件', 750.00, '支付宝', '浙江', '已完成', FALSE, NULL),
('ORD-20261002-012', '2026-10-02 09:42:00', '抖音直播', 'CUST-6120', '普通会员', '品质美妆与护肤', '深层洁净氨基酸洁面慕斯', 139.00, '抖音支付', '河南', '已完成', FALSE, NULL),
('ORD-20261002-013', '2026-10-02 11:20:55', '天猫旗舰', 'CUST-8831', 'SVIP黑卡', '数码 3C & 智能穿戴', '骨传导专业运动防水耳机', 999.00, '支付宝', '北京', '已完成', FALSE, NULL),
('ORD-20261002-014', '2026-10-02 13:10:30', '微信小程序', 'CUST-7740', '金卡会员', '潮流服饰与箱包', '真皮极简商旅电脑手提包', 850.00, '微信支付', '广东', '已完成', FALSE, NULL),
('ORD-20261002-015', '2026-10-02 15:45:00', 'App自营', 'CUST-9921', 'SVIP黑卡', '智能家居与生活电器', '台式即热净饮一体机', 1599.00, '微信支付', '江苏', '已完成', FALSE, NULL),
('ORD-20261002-016', '2026-10-02 17:15:20', '抖音直播', 'CUST-1049', '普通会员', '户外运动与骑行露营', '高山徒步防泼水冲锋衣', 599.00, '抖音支付', '陕西', '已完成', FALSE, NULL),
('ORD-20261002-017', '2026-10-02 19:00:10', 'App自营', 'CUST-4509', '金卡会员', '数码 3C & 智能穿戴', '机械键盘 客制化轴体 87键', 499.00, '支付宝', '上海', '已完成', FALSE, NULL),
('ORD-20261002-018', '2026-10-02 21:30:00', '天猫旗舰', 'CUST-6623', '白银会员', '潮流服饰与箱包', '羊绒加厚保暖围巾', 320.00, '支付宝', '辽宁', '已退款', TRUE, '发货慢/未按约定发货'),
('ORD-20261003-019', '2026-10-03 10:10:00', '微信小程序', 'CUST-2088', '普通会员', '品质美妆与护肤', '维C亮肤焕采安瓶精华', 298.00, '微信支付', '湖南', '已完成', FALSE, NULL),
('ORD-20261003-020', '2026-10-03 14:05:00', 'App自营', 'CUST-9310', 'SVIP黑卡', '智能家居与生活电器', '便携式咖啡手冲大师套件', 1199.00, '微信支付', '广东', '已完成', FALSE, NULL);

-- 生成更多随机订单丰富数据（利用 generate_series 生成 80 笔扩展订单）
INSERT INTO orders (
    order_id, created_at, channel, customer_id, vip_level,
    category, product_name, amount, payment_method, province,
    order_status, is_refunded, refund_reason
)
SELECT
    'ORD-202610' || LPAD(s::text, 4, '0'),
    TIMESTAMP '2026-10-03 00:00:00' + (s * INTERVAL '2 hours 15 minutes'),
    (ARRAY['App自营', '天猫旗舰', '抖音直播', '微信小程序'])[1 + (s % 4)],
    'CUST-' || (1000 + (s * 37) % 9000)::text,
    (ARRAY['普通会员', '白银会员', '金卡会员', 'SVIP黑卡'])[1 + (s % 4)],
    (ARRAY['数码 3C & 智能穿戴', '品质美妆与护肤', '潮流服饰与箱包', '智能家居与生活电器', '户外运动与骑行露营'])[1 + (s % 5)],
    (ARRAY['无线降噪头戴耳机', '玻尿酸水光保湿乳', '羊毛廓形大衣', '空气炸锅触控版', '露营户外野餐天幕', '电竞人体工学椅', '机械复古打字机键盘'])[1 + (s % 7)],
    ROUND((150.0 + (s * 43.7) % 3200)::numeric, 2),
    (ARRAY['微信支付', '支付宝', '花呗分期', '抖音支付'])[1 + (s % 4)],
    (ARRAY['广东', '浙江', '江苏', '北京', '上海', '四川', '湖北', '山东'])[1 + (s % 8)],
    CASE WHEN s % 9 = 0 THEN '已退款' ELSE '已完成' END,
    CASE WHEN s % 9 = 0 THEN TRUE ELSE FALSE END,
    CASE WHEN s % 9 = 0 THEN (ARRAY['尺码不合适', '拍错/多拍', '商品瑕疵', '七天无理由退货'])[1 + (s % 4)] ELSE NULL END
FROM generate_series(21, 100) AS s;
