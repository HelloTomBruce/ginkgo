import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 架构守卫（可执行断言）。
 *
 * 把 AGENTS.md 里的三条底座原则变成 CI 会跑的测试，而不是靠 code review 记得：
 *   1. 宿主零应用领域语义（`src/**` 不得出现具体应用的厂商关键词）；
 *   2. 存储根唯一（`src/**` 不得再自己拼 `cwd + data/config`）；
 *   3. 依赖单向（应用包/能力包不得 import 宿主 `@/`）。
 *
 * 之所以用测试而不是 eslint 规则：这些是**跨文件、跨目录**的约束，
 * 用 AST 规则表达成本高且易误报；一次目录遍历足够，且失败信息能直接给出文件行。
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".git",
  "coverage",
  ".dsh-browser",
]);
const CODE_EXT = new Set([".ts", ".tsx", ".mts"]);

interface Offense {
  file: string;
  line: number;
  text: string;
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|mts)$/.test(file);
}

async function collectFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, out);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** 扫描给定目录下命中任一模式的行 */
async function scan(
  dir: string,
  patterns: RegExp[],
  options: { skipTests?: boolean; skip?: (file: string) => boolean } = {}
): Promise<Offense[]> {
  const files = await collectFiles(dir);
  const offenses: Offense[] = [];

  for (const file of files) {
    if (options.skipTests && isTestFile(file)) continue;
    if (options.skip?.(file)) continue;

    const content = await fs.readFile(file, "utf-8");
    content.split("\n").forEach((line, index) => {
      if (patterns.some((re) => re.test(line))) {
        offenses.push({
          file: path.relative(REPO_ROOT, file),
          line: index + 1,
          text: line.trim().slice(0, 120),
        });
      }
    });
  }
  return offenses;
}

function format(offenses: Offense[]): string {
  return offenses
    .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
    .join("\n");
}

describe("架构守卫", () => {
  it("宿主 src/ 不得包含具体应用的厂商关键词（语义声明化）", async () => {
    // 只拦「内嵌进逻辑的厂商 CLI 名」。UI 文案里举例（如 MCP 支持的第三方系统）
    // 属于面向用户的说明，不构成平台对某个应用的耦合，故不纳入本守卫。
    const offenses = await scan(
      path.join(REPO_ROOT, "src"),
      [/claude[_-]design/i, /claude[_-]data/i],
      { skipTests: true }
    );

    expect(offenses, `宿主层出现应用领域语义：\n${format(offenses)}`).toEqual([]);
  });

  it("能力协商器不得执行外部命令（外部依赖由应用自治探测）", async () => {
    const negotiator = await fs.readFile(
      path.join(REPO_ROOT, "src/lib/apps/capabilityNegotiator.ts"),
      "utf-8"
    );

    // 曾经的违规形态：宿主里 if (cap === "…cli") { await hasCommand("…") }
    // 现在这里只做「平台能力判定 + 调度应用的 healthCheck」
    expect(negotiator).not.toMatch(/execFile|execSync|spawn\(|["']which["']/);
  });

  it("宿主 src/ 不得自己拼 cwd + data/config（存储根唯一出口）", async () => {
    const offenses = await scan(
      path.join(REPO_ROOT, "src"),
      [/process\.cwd\(\)[^\n]*["'](data|config)["']/],
      {
        skipTests: true,
        // storagePaths 是唯一允许解析根目录的地方（含历史布局兼容）
        skip: (file) => file.endsWith(path.join("src", "lib", "storagePaths.ts")),
      }
    );

    expect(
      offenses,
      `存储路径必须经 src/lib/storagePaths.ts：\n${format(offenses)}`
    ).toEqual([]);
  });

  it("应用包与能力包不得 import 宿主 @/（依赖单向）", async () => {
    const targets = [
      "packages/ginkgo-llm/src",
      "packages/ginkgo-harness-core/src",
      "packages/ginkgo-datasources/src",
      "packages/ginkgo-sandbox/src",
      "packages/ginkgo-components/src",
      "packages/ginkgo-models/src",
      "packages/apps/app-analytics/src",
      "packages/apps/app-general/src",
      "packages/apps/app-design/src",
    ];

    const all: Offense[] = [];
    for (const target of targets) {
      all.push(
        ...(await scan(path.join(REPO_ROOT, target), [/from ["']@\//], {
          skipTests: true,
        }))
      );
    }

    expect(all, `包内穿透宿主路径：\n${format(all)}`).toEqual([]);
  });

  it("源码不得 import 被 gitignore 的运行期目录（config/ 与 data/）", async () => {
    // config/ 与 data/ 是本机运行期数据目录（含用户密钥、会话），必须 gitignore；
    // 一旦被当作模块 import，全新克隆与 CI 会直接失败（真实踩过：config/apps.json）。
    const targets = ["src", "packages"];
    const all: Offense[] = [];
    for (const target of targets) {
      all.push(
        ...(await scan(
          path.join(REPO_ROOT, target),
          [/from\s+["'][^"']*\/(config|data)\/[^"']*\.(json|ts)["']/],
          { skipTests: true }
        ))
      );
    }

    expect(
      all,
      `运行期目录不得作为模块 import（种子请放进 src/ 下的常量）：\n${format(all)}`
    ).toEqual([]);
  });

  it("安装接口的门禁开关必须存在（防止有人把高危能力改成默认开启）", async () => {
    const routePath = path.join(
      REPO_ROOT,
      "src/app/api/apps/install/route.ts"
    );
    const source = await fs.readFile(routePath, "utf-8");

    // 默认关闭 + 独立令牌：两者都是安全决策，改动必须在 review 中被显式讨论
    expect(source).toContain("GINKGO_ALLOW_APP_INSTALL");
    expect(source).toContain("GINKGO_APP_INSTALL_TOKEN");
    expect(source).toMatch(/!==\s*["']1["']/);
  });
});
