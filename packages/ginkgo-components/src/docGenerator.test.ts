import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineComponent, createLibrary } from "@openuidev/lang-core";
import { extractPropsSignature, renderComponentKitDocumentation } from "./docGenerator";

describe("docGenerator 组件文档自动派生", () => {
  it("extractPropsSignature 正确提取必填与可选参数", () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
      subtitle: z.string().optional(),
      extra: z.any().optional(),
    });
    expect(extractPropsSignature(schema)).toBe("(title, count, subtitle?, extra?)");
  });

  it("extractPropsSignature 对非 ZodObject 返回 ()", () => {
    expect(extractPropsSignature(z.string())).toBe("()");
  });

  it("renderComponentKitDocumentation 自动生成组件规范文档", () => {
    const Card = defineComponent({
      name: "MetricCard",
      description: "KPI 卡片展示核心指标",
      props: z.object({
        title: z.string(),
        value: z.number(),
        trend: z.string().optional(),
      }),
      component: () => null,
    });

    const Root = defineComponent({
      name: "Root",
      description: "顶级容器",
      props: z.object({ children: z.array(z.any()) }),
      component: () => null,
    });

    const lib = createLibrary({ components: [Root, Card], root: "Root" });
    const docWithCustom = renderComponentKitDocumentation(lib, { MetricCard: "自定义卡片描述" });
    expect(docWithCustom).toContain("- **MetricCard(title, value, trend?)**: 自定义卡片描述");

    const docDefault = renderComponentKitDocumentation(lib);
    expect(docDefault).toContain("## Visual Component Kit (Dashboard DSL):");
    expect(docDefault).toContain("- **MetricCard(title, value, trend?)**: KPI stats card with optional sparkline micro trend.");
    expect(docDefault).not.toContain("- **Root");
  });
});
