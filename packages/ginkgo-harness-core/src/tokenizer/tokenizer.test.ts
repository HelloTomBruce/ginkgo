import { describe, it, expect, vi } from "vitest";
import {
  estimateTextTokensHeuristic,
  HeuristicTokenizer,
  resolveEncodingForModel,
  createTiktokenEstimator,
  DEFAULT_TIKTOKEN_ENCODING,
} from "./index";

describe("harness-core: tokenizer", () => {
  it("estimateTextTokensHeuristic correctly estimates CJK and ASCII tokens", () => {
    expect(estimateTextTokensHeuristic("")).toBe(0);

    const asciiText = "Hello world"; // 11 chars
    // 11 / 4 * 1.1 = 3.025 -> ceil is 4
    expect(estimateTextTokensHeuristic(asciiText)).toBeGreaterThan(0);

    const cjkText = "你好世界"; // 4 CJK chars
    // 4 / 1.5 * 1.1 = 2.93 -> ceil is 3
    expect(estimateTextTokensHeuristic(cjkText)).toBe(3);

    const mixed = "OpenAI 大模型";
    const tok = new HeuristicTokenizer();
    expect(tok.encode(mixed)).toBeGreaterThan(0);
  });

  it("resolveEncodingForModel handles longest prefix matching", () => {
    const mapping = {
      gpt: "cl100k_base",
      "gpt-4o": "o200k_base",
      claude: "claude_enc",
    };

    expect(resolveEncodingForModel("gpt-4o-mini", mapping)).toBe("o200k_base");
    expect(resolveEncodingForModel("gpt-3.5-turbo", mapping)).toBe("cl100k_base");
    expect(resolveEncodingForModel("claude-3-5-sonnet", mapping)).toBe("claude_enc");
    expect(resolveEncodingForModel("unknown-model", mapping)).toBe(DEFAULT_TIKTOKEN_ENCODING);
    expect(resolveEncodingForModel("gpt-4", undefined)).toBe(DEFAULT_TIKTOKEN_ENCODING);
  });

  it("createTiktokenEstimator gracefully handles missing package or loads it", async () => {
    const onWarn = vi.fn();
    const estimator = await createTiktokenEstimator("cl100k_base", {
      onWarnMissing: onWarn,
    });
    // In harness-core dev environment, js-tiktoken might or might not be installed
    if (estimator) {
      expect(estimator.encode("Hello world")).toBeGreaterThan(0);
    } else {
      expect(estimator).toBeUndefined();
    }
  });
});
