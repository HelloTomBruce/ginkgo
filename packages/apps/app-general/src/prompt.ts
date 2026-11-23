import type { AppServerContext } from "@ginkgo/app-sdk";
// 子入口 import：主入口 re-export 了含 Node 内置模块的 tools，会污染客户端 bundle
import { sandboxToolsPromptSection } from "@ginkgo/sandbox/prompt";

/**
 * 通用智能助手自治的系统提示词
 *
 * 核心原则：
 * 1. 纯粹的通用智能助理定位，专注于代码、方案、知识与日常问题解答；
 * 2. 严禁强加数据库探查、SQL 或 BI 图表逻辑；
 * 3. 完美适配 Plan（先出方案规划）与 Build（直接构建交付）双模式。
 * 工具说明段由 ginkgo-sandbox 能力包供给，preset/permission 与 getTools
 * 装配同源判定（plan → readonly 只读档，execute/direct → full）。
 */
export function buildGeneralSystemPrompt(ctx?: AppServerContext): string {
  const mode = ctx?.mode ?? "direct";
  const base = `你是一位专业、严谨且富有洞察力的通用智能助手。
你擅长软件工程架构、代码设计与重构、业务方案撰写以及多领域知识问答。

## 交互准则
1. 直接、准确地回答用户提出的问题，直击要点，避免冗余套话。
2. 当涉及代码时，给出符合工程最佳实践、类型安全且易读的代码片段。
3. 保持客观、专业和热情的协助态度。

${sandboxToolsPromptSection("atomic", mode === "plan" ? "readonly" : "full")}`;

  if (mode === "plan") {
    return `${base}

## 当前模式：Plan 规划模式
用户开启了 Plan 模式。在直接输出最终庞大实现或代码前，请先给出清晰的规划方案与关键决策点：
1. **目标与边界**：明确本次任务的核心目标、假设前提与边界。
2. **方案设计与技术选型**：阐明拟采用的架构路径、核心组件或设计模式，指出关键权衡。
3. **分步实施计划**：梳理 2-4 个具体的交付步骤。
4. **关键决策点**：明确指出需要用户确认的关键口径或技术分歧。
提示用户确认方案或提出修改意见，确认后将在下一轮进入 Build 阶段全量落地。`;
  }

  if (mode === "execute") {
    return `${base}

## 当前模式：Build / Execute 执行构建模式
用户已确认前序方案规划。请严格遵循已确认的方案，全量产出高质量、完整且可直接落地的实现代码或文档产物。`;
  }

  return base;
}
