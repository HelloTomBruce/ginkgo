import { describe, it, expect } from "vitest";
import { applyJsonPatch, parseJsonPointer, type JsonPatchOperation } from "./jsonPatch";

describe("JSON Patch 增量编辑引擎", () => {
  it("parseJsonPointer 正确解析路径", () => {
    expect(parseJsonPointer("/widgets/w1/type")).toEqual(["widgets", "w1", "type"]);
    expect(parseJsonPointer("/")).toEqual([]);
    expect(parseJsonPointer("/a~1b")).toEqual(["a/b"]);
  });

  it("replace 操作：局部修改对象属性与数组元素", () => {
    const doc = {
      title: "原标题",
      widgets: {
        w1: { type: "line", count: 10 },
      },
      tags: ["tag1", "tag2"],
    };

    const patches: JsonPatchOperation[] = [
      { op: "replace", path: "/title", value: "新标题" },
      { op: "replace", path: "/widgets/w1/type", value: "bar" },
      { op: "replace", path: "/tags/1", value: "tag_updated" },
    ];

    const result = applyJsonPatch(doc, patches);
    expect(result.success).toBe(true);
    expect(result.doc.title).toBe("新标题");
    expect(result.doc.widgets.w1.type).toBe("bar");
    expect(result.doc.tags[1]).toBe("tag_updated");

    // 原始对象不受污染（不可变深拷贝）
    expect(doc.title).toBe("原标题");
  });

  it("add 操作：向对象添加属性与向数组追加", () => {
    const doc = {
      items: [1, 2],
      config: {},
    };

    const patches: JsonPatchOperation[] = [
      { op: "add", path: "/items/-", value: 3 },
      { op: "add", path: "/config/theme", value: "dark" },
    ];

    const result = applyJsonPatch(doc, patches);
    expect(result.success).toBe(true);
    expect(result.doc.items).toEqual([1, 2, 3]);
    expect((result.doc.config as { theme: string }).theme).toBe("dark");
  });

  it("remove 与 test 校验操作", () => {
    const doc = {
      toDelete: "x",
      version: 2,
    };

    const patches: JsonPatchOperation[] = [
      { op: "test", path: "/version", value: 2 },
      { op: "remove", path: "/toDelete" },
    ];

    const result = applyJsonPatch(doc, patches);
    expect(result.success).toBe(true);
    expect("toDelete" in result.doc).toBe(false);
  });

  it("原子性测试：中间步骤失败时整体回滚", () => {
    const doc = { a: 1, b: 2 };
    const patches: JsonPatchOperation[] = [
      { op: "replace", path: "/a", value: 100 },
      { op: "test", path: "/b", value: 999 }, // 校验失败
    ];

    const result = applyJsonPatch(doc, patches);
    expect(result.success).toBe(false);
    expect(result.doc.a).toBe(1); // 回滚为初始状态
    expect(result.error).toContain("Test 校验失败");
  });

  it("原型链保护：拒绝 __proto__/constructor/prototype 路径段", () => {
    const doc = { a: 1 };
    for (const seg of ["__proto__", "constructor", "prototype"]) {
      const result = applyJsonPatch(doc, [
        { op: "add", path: `/${seg}/polluted`, value: true },
      ]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("原型链保护");
    }
    // 文档与全局原型均未受污染
    expect((doc as Record<string, unknown>).__proto__).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("根路径 replace 正确整文档替换，其他根操作报错", () => {
    const doc = { a: 1, b: 2 };
    const replaced = applyJsonPatch(doc, [
      { op: "replace", path: "", value: { c: 3 } },
    ]);
    expect(replaced.success).toBe(true);
    expect(replaced.doc).toEqual({ c: 3 });
    // 原文档不可变
    expect(doc).toEqual({ a: 1, b: 2 });

    const badOp = applyJsonPatch(doc, [{ op: "remove", path: "" }]);
    expect(badOp.success).toBe(false);

    const badValue = applyJsonPatch(doc, [
      { op: "replace", path: "", value: "not-an-object" },
    ]);
    expect(badValue.success).toBe(false);
  });

  it("数组 add 索引校验：越界与非整数索引报错", () => {
    const doc = { items: [1, 2] };
    const oob = applyJsonPatch(doc, [{ op: "add", path: "/items/5", value: 9 }]);
    expect(oob.success).toBe(false);
    expect(oob.error).toContain("越界");

    const nan = applyJsonPatch(doc, [{ op: "add", path: "/items/abc", value: 9 }]);
    expect(nan.success).toBe(false);

    // 合法插入中间位置
    const ok = applyJsonPatch(doc, [{ op: "add", path: "/items/1", value: 9 }]);
    expect(ok.success).toBe(true);
    expect(ok.doc.items).toEqual([1, 9, 2]);
  });
});
