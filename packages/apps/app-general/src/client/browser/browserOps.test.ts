import { describe, it, expect } from "vitest";
import type { AppWorkspaceMessage } from "@ginkgo/app-sdk";
import {
  buildRawFileUrl,
  extractBrowserOperations,
  messagesExtractionSignature,
} from "./browserOps";

/** 测试辅助：构造一条仅含指定工具调用的消息 */
function msgWithInvocations(
  id: string,
  invocations: Array<{
    toolCallId?: string;
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
  }>,
  createdAt?: AppWorkspaceMessage["createdAt"]
): AppWorkspaceMessage {
  return {
    id,
    role: "assistant",
    ...(createdAt !== undefined ? { createdAt } : {}),
    parts: invocations.map((inv) => ({ type: "tool-invocation", toolInvocation: inv })),
  };
}

describe("buildRawFileUrl", () => {
  it("拼装 appId/sessionId/filePath 并 raw=true", () => {
    expect(buildRawFileUrl("general", "sess_1", "screenshots/a.png")).toBe(
      "/api/workspace?appId=general&sessionId=sess_1&filePath=screenshots%2Fa.png&raw=true"
    );
  });

  it("对特殊字符做 URI 编码", () => {
    const url = buildRawFileUrl("app x", "sess/1", "screenshots/我的 截图.png");
    expect(url).toContain("appId=app%20x");
    expect(url).toContain("sessionId=sess%2F1");
    expect(url).toContain("filePath=screenshots%2F%E6%88%91%E7%9A%84%20%E6%88%AA%E5%9B%BE.png");
    expect(url.endsWith("&raw=true")).toBe(true);
  });

  it("仅在提供非零 cacheBust 时追加 t 参数", () => {
    expect(buildRawFileUrl("general", "s", "a.png", 1700000000000)).toContain("&t=1700000000000");
    expect(buildRawFileUrl("general", "s", "a.png", 0)).not.toContain("&t=");
    expect(buildRawFileUrl("general", "s", "a.png")).not.toContain("&t=");
  });
});

describe("extractBrowserOperations: 时间戳归一化", () => {
  const epoch = 1700000000000;

  it("兼容 Date / ISO 字符串 / 毫秒时间戳三种 createdAt 形态", () => {
    const make = (createdAt: NonNullable<AppWorkspaceMessage["createdAt"]>) =>
      extractBrowserOperations([msgWithInvocations("m", [{ toolName: "browser_open" }], createdAt)]);

    expect(make(new Date(epoch))[0].timestamp).toBe(epoch);
    expect(make(new Date(epoch).toISOString())[0].timestamp).toBe(epoch);
    expect(make(epoch)[0].timestamp).toBe(epoch);
  });

  it("缺失或非法 createdAt 时回落为当前时间（非 NaN、非 0）", () => {
    const ops = extractBrowserOperations([msgWithInvocations("m", [{ toolName: "browser_open" }])]);
    const ts = ops[0].timestamp;
    expect(ts).toBeGreaterThan(0);
    expect(Date.now() - ts).toBeLessThan(5000);

    const bad = extractBrowserOperations([
      msgWithInvocations("m", [{ toolName: "browser_open" }], "not-a-date"),
    ]);
    expect(bad[0].timestamp).toBeGreaterThan(0);
  });
});

describe("extractBrowserOperations: 兜底 id 稳定性", () => {
  it("无 toolCallId 时由消息 id + 序号派生，重复计算结果一致", () => {
    const msgs = [
      msgWithInvocations("m_1", [{ toolName: "browser_open" }, { toolName: "browser_find" }]),
    ];

    const first = extractBrowserOperations(msgs);
    const second = extractBrowserOperations(msgs);

    expect(first.map((o) => o.id)).toEqual(["op-m_1-0", "op-m_1-1"]);
    expect(second.map((o) => o.id)).toEqual(first.map((o) => o.id));
  });

  it("消息缺 id 时兜底前缀稳定且不同步骤不互相碰撞", () => {
    const ops = extractBrowserOperations([
      { parts: [{ type: "tool-invocation", toolInvocation: { toolName: "browser_open" } }] },
      { parts: [{ type: "tool-invocation", toolInvocation: { toolName: "browser_find" } }] },
    ]);
    expect(ops[0].id).not.toBe(ops[1].id);
  });
});

describe("extractBrowserOperations: 状态与过滤", () => {
  it("非 browser_* 工具被过滤，args 提取意图目标", () => {
    const ops = extractBrowserOperations([
      msgWithInvocations("m", [
        { toolName: "read_file", args: { path: "a.txt" } },
        { toolName: "browser_click", args: { what: "登录" } },
        { toolName: "browser_open", args: {} },
      ]),
    ]);
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.toolName)).toEqual(["browser_click", "browser_open"]);
    expect(ops[0].state).toBe("call");
    expect(ops[0].what).toBe("登录");
  });
});

describe("messagesExtractionSignature（流式热路径签名）", () => {
  it("空消息返回稳定哨兵", () => {
    expect(messagesExtractionSignature([])).toBe("empty");
  });

  it("签名只在提取输出会变时变化（模拟流式序列）", () => {
    // T1: 末条消息带一个调用中的工具
    const callMsg = msgWithInvocations("m1", [{ toolCallId: "c1", toolName: "browser_open" }]);
    const s1 = messagesExtractionSignature([callMsg]);

    // T2: 调用完成（result 到位）→ 签名必须变化
    const doneMsg = msgWithInvocations("m1", [
      { toolCallId: "c1", toolName: "browser_open", result: { url: "https://x" } },
    ]);
    const s2 = messagesExtractionSignature([doneMsg]);
    expect(s2).not.toBe(s1);

    // T3: 追加新消息与新调用 → 签名必须变化
    const appended = [
      doneMsg,
      msgWithInvocations("m2", [{ toolCallId: "c2", toolName: "browser_find" }]),
    ];
    expect(messagesExtractionSignature(appended)).not.toBe(s2);

    // T4: 与提取无关的字段变化（role）不影响签名 → 不触发重提取
    expect(messagesExtractionSignature([{ ...doneMsg, role: "user" }])).toBe(s2);
  });

  it("同输入签名幂等（可安全作为 memo 依赖）", () => {
    const msgs = [msgWithInvocations("m1", [{ toolName: "browser_open" }])];
    expect(messagesExtractionSignature(msgs)).toBe(messagesExtractionSignature(msgs));
  });
});
