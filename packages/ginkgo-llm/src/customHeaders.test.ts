import { describe, it, expect } from "vitest";
import { normalizeCustomHeaders } from "./handler";

/**
 * Provider 自定义请求头的安全护栏。
 *
 * 客户端可以配置任意头，但服务端必须挡住会改变「请求发到哪、以谁的身份、
 * 用什么编码」的敏感头——否则 apiKey 凭证护栏（baseURL 与 apiKey 必须配对
 * 提供）可被绕过，环境凭证会被改投到请求体指定的 URL。
 */
describe("normalizeCustomHeaders", () => {
  it("正常头原样保留（OpenCode Go 场景）", () => {
    expect(
      normalizeCustomHeaders({
        "x-opencode-session": "sess_abc123",
        "User-Agent": "ginkgo-agent/0.1.3",
      })
    ).toEqual({
      "x-opencode-session": "sess_abc123",
      "User-Agent": "ginkgo-agent/0.1.3",
    });
  });

  it("支持设置页的数组形态", () => {
    expect(
      normalizeCustomHeaders([
        { name: "x-opencode-session", value: "sess_1" },
        { name: "", value: "ignored" },
        { name: "X-Trace", value: " t-1 " },
      ])
    ).toEqual({ "x-opencode-session": "sess_1", "X-Trace": "t-1" });
  });

  it("敏感头一律拒绝（大小写不敏感）", () => {
    const result = normalizeCustomHeaders({
      Authorization: "Bearer attacker",
      authorization: "Bearer attacker2",
      "Content-Type": "text/plain",
      "content-length": "999",
      Host: "evil.example",
      Cookie: "session=stolen",
      "Set-Cookie": "x=1",
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
      Upgrade: "h2c",
      "x-opencode-session": "sess_ok",
    });
    // 只剩非敏感头
    expect(result).toEqual({ "x-opencode-session": "sess_ok" });
    expect(Object.keys(result ?? {})).not.toContain("Authorization");
  });

  it("header 注入（含换行）被拒绝", () => {
    const result = normalizeCustomHeaders({
      "x-evil": "value\r\nInjected-Header: pwned",
      "x-ok": "fine",
    });
    expect(result).toEqual({ "x-ok": "fine" });
  });

  it("非法头名被拒绝", () => {
    const result = normalizeCustomHeaders({
      "bad header": "x", // 含空格
      "x@invalid": "y",
      "x-valid": "z",
    });
    expect(result).toEqual({ "x-valid": "z" });
  });

  it("空值、非字符串值被丢弃", () => {
    expect(
      normalizeCustomHeaders({
        "x-empty": "",
        "x-blank": "   ",
        "x-number": 123,
        "x-null": null,
        "x-ok": "v",
      })
    ).toEqual({ "x-ok": "v" });
  });

  it("超长值被拒绝（>4096）", () => {
    const long = "a".repeat(4097);
    expect(normalizeCustomHeaders({ "x-long": long, "x-ok": "v" })).toEqual({ "x-ok": "v" });
  });

  it("数量上限 20 条", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 30; i++) many[`x-h${i}`] = `v${i}`;
    const result = normalizeCustomHeaders(many) ?? {};
    expect(Object.keys(result).length).toBe(20);
  });

  it("全部无效时返回 undefined（不注入空 headers）", () => {
    expect(normalizeCustomHeaders({ Authorization: "x" })).toBeUndefined();
    expect(normalizeCustomHeaders([])).toBeUndefined();
    expect(normalizeCustomHeaders({})).toBeUndefined();
    expect(normalizeCustomHeaders("not-an-object")).toBeUndefined();
    expect(normalizeCustomHeaders(null)).toBeUndefined();
    expect(normalizeCustomHeaders(undefined)).toBeUndefined();
  });
});

