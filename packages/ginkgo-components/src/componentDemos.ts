/**
 * 组件目录演示样例：组件名 → UiSpec DSL 片段（生产渲染路径同源）。
 *
 * 供「可视化组件」查看弹窗的条目做缩小实况预览：经 <Renderer library/>
 * 渲染，与真实分析产出完全同路径（上下文/动作体系一致），颜色走主题
 * token 亮暗自适应。DSL 位置参数顺序 = 各组件 defineComponent 的
 * props 注册顺序。
 *
 * 新增组件时：注册 library + componentCatalog 后，可在此补一行演示；
 * 没有演示的组件条目仅展示名称与描述。Root 为 DSL 根容器，不设演示。
 */

/** 目录演示注册表（key 与 componentCatalog 的组件名一致） */
export const componentDemos: Readonly<Record<string, string>> = {
  MetricGrid: `
c1 = MetricCard("月度 GMV", "¥1,284万", "+12.6%", "up", "环比上月")
c2 = MetricCard("新客数", "8,392", "-3.1%", "down", "含全域拉新")
root = Root([MetricGrid(2, [c1, c2])])`,

  ReportLayout: `
kpi = MetricCard("支付 GMV", "¥982万", "+8.4%", "up", "全渠道")
chart = AnalyticsChart("bar", "渠道 GMV 构成", "", "name", [{"name":"直营","amount":420},{"name":"平台","amount":312},{"name":"直播","amount":250}], [{"key":"amount","name":"GMV（万）"}], 110)
root = Root([ReportLayout("电商月度经营报告", "2026-10 · 全渠道", [kpi], [chart])])`,

  FocusLayout: `
main = AnalyticsChart("line", "直播单量走势", "", "week", [{"week":"W1","orders":120},{"week":"W2","orders":168},{"week":"W3","orders":150},{"week":"W4","orders":205}], [{"key":"orders","name":"单量"}], 110)
side = MetricCard("峰值周", "W4 · 205 单", "+36.7%", "up", "环比 W1")
root = Root([FocusLayout("渠道单量聚焦", "直播渠道深钻", [main], [side])])`,

  ComparisonLayout: `
l = MetricCard("毛利率", "38.2%", "+1.8%", "up", "直营")
r = MetricCard("毛利率", "31.5%", "-0.6%", "down", "分销")
v = InsightBox("success", "结论", "直营毛利率高出 6.7pct，建议加大直营投放")
root = Root([ComparisonLayout("A/B 渠道对比", "口径：剔除退款", "直营", [l], "分销", [r], [v])])`,

  MonitoringLayout: `
b = InsightBox("warning", "告警摘要", "支付网关失败率达到 4.2%，超出健康阈值 1.5%")
m1 = MetricCard("失败率", "4.2%", "+2.8%", "down", "较平日均值偏高")
m2 = MetricCard("影响订单", "1,240 笔", "+340", "down", "主要集中在银联通道")
root = Root([MonitoringLayout("支付网关异常率巡检", "近24小时异动排查", "critical", b, null, [m1, m2])])`,

  CohortRetentionLayout: `
k1 = MetricCard("次日留存", "42.8%", "+3.2%", "up", "新版上线提升")
k2 = MetricCard("7日留存", "24.5%", "-0.6%", "down", "长周期衰减平稳")
c = AnalyticsChart("line", "留存衰减走势", "", "day", [{"day":"Day 1","rate":42.8},{"day":"Day 3","rate":32.1},{"day":"Day 7","rate":24.5}], [{"key":"rate","label":"留存率(%)"}], 120)
root = Root([CohortRetentionLayout("Q3 新客全周期留存追踪", "按注册首周观察", null, [k1, k2], null, c)])`,

  MetricCard: `
c1 = MetricCard("月度 GMV", "¥1,284万", "+12.6%", "up", "环比上月")
c2 = MetricCard("退款率", "2.1%", "+0.4%", "down", "高于阈值 2.0%")
root = Root([c1, c2])`,

  GaugeProgress: `
root = Root([GaugeProgress("季度目标达成", "Q4 GMV 进度", 784, 1000, "万", "已完成 78.4%")])`,

  AnalyticsChart: `
root = Root([AnalyticsChart("area", "月度营收走势", "", "name", [{"name":"1月","amount":320},{"name":"2月","amount":410},{"name":"3月","amount":380},{"name":"4月","amount":520}], [{"key":"amount","name":"营收（万）"}], 150)])`,

  SpecChart: `
root = Root([SpecChart("渠道销售额（bar）", {"chartType":"bar","dims":[{"field":"channel"}],"meas":[{"field":"amount","label":"销售额（万）"}]}, "", [{"channel":"直营","amount":420},{"channel":"平台","amount":312},{"channel":"直播","amount":250}], 150)])`,

  ComboChart: `
root = Root([ComboChart("月度销售额与转化率", "柱状图看销量，折线图看比率", "month", [{"month":"1月","sales":120,"rate":12},{"month":"2月","sales":210,"rate":18},{"month":"3月","sales":180,"rate":15}], [{"key":"sales","label":"销售额","type":"bar","yAxis":"left"},{"key":"rate","label":"转化率","type":"line","yAxis":"right","unit":"%"}], 150)])`,

  FunnelChart: `
root = Root([FunnelChart("投放转化漏斗", "曝光到支付全链路", [{"name":"曝光","value":120000},{"name":"点击","value":18000,"conversion":"15.0%"},{"name":"下单","value":2340,"conversion":"13.0%"},{"name":"支付","value":1872,"conversion":"80.0%"}], "次")])`,

  RadarChart: `
root = Root([RadarChart("渠道能力画像", "规模/增速/毛利/复购", [{"metric":"规模","直营":82,"分销":65},{"metric":"增速","直营":74,"分销":88},{"metric":"毛利","直营":90,"分销":61},{"metric":"复购","直营":66,"分销":72}], "metric", [{"key":"直营","label":"直营"},{"key":"分销","label":"分销"}], 150)])`,

  ContributionHeatmap: `
root = Root([ContributionHeatmap("提交活跃度", "近三周样本", [{"count":0},{"count":2},{"count":5},{"count":9},{"count":14},{"count":5},{"count":2},{"count":9},{"count":14},{"count":0},{"count":5},{"count":2},{"count":9},{"count":5}], "green")])`,

  DataTable: `
root = Root([DataTable("渠道明细", [{"key":"channel","label":"渠道"},{"key":"amount","label":"GMV（万）"},{"key":"ratio","label":"占比"}], [{"channel":"直营","amount":420,"ratio":"42.8%"},{"channel":"平台","amount":312,"ratio":"31.8%"},{"channel":"直播","amount":250,"ratio":"25.4%"}])])`,

  RankingList: `
root = Root([RankingList("获客渠道 Top 5", "按获客单量降序排列", [{"label":"自然搜索","value":45000,"secondary":"+12%"},{"label":"信息流广告","value":32000,"secondary":"+8%"},{"label":"短视频带货","value":28000},{"label":"邮件召回","value":15000},{"label":"渠道合作","value":9800}], 5, "number")])`,

  InsightBox: `
b1 = InsightBox("success", "结论", "直营渠道毛利率领先 6.7pct，建议追加预算")
b2 = InsightBox("warning", "风险", "退款率连续两周高于 2.0% 阈值")
root = Root([b1, b2])`,

  ActionPlanCard: `
root = Root([ActionPlanCard("行动建议", "基于毛利率与退款率归因", [{"title":"直营渠道追加 20% 预算","priority":"high","impact":"预计 GMV +5%"},{"title":"排查直播退款原因","priority":"medium","owner":"运营组"}])])`,

  ActivityTimeline: `
root = Root([ActivityTimeline("近期动态", "", [{"time":"11-09","title":"大促预案评审通过","status":"success","tag":"里程碑"},{"time":"11-08","title":"直播退款率超阈值","status":"warning","tag":"告警"}])])`,

  AnalyticsFilterBar: `
root = Root([AnalyticsFilterBar("数据筛选", "直营", "GMV")])`,

  ActionButton: `
b1 = ActionButton("重新物化数据", "primary", "play")
b2 = ActionButton("导出 CSV", "outline", "download")
b3 = ActionButton("复制结论", "secondary", "copy")
root = Root([b1, b2, b3])`,

  ReactiveSimulator: `
root = Root([ReactiveSimulator("预算试算", 50000, "直播", 19.9, 0.146)])`,

  PlanReviewCard: `
root = Root([PlanReviewCard("分析思路确认", "直播渠道退款率为何上升？", ["订单库"], [{"title":"按 SKU 聚合退款率","detail":"定位头部退款 SKU","chart":"SpecChart"},{"title":"对比物流时效","detail":"排查发货延迟影响"}])])`,
};
