/**
 * 发布后冒烟的"子进程脚本"：安装目录内的真实消费者视角检查。
 * 由 scripts/smoke-published.mjs 复制到临时工程后执行（ESM 解析以脚本位置为准）。
 */
const out = [];
let failed = false;

async function check(label, fn) {
  try {
    out.push(`${label}: ✅ ${await fn()}`);
  } catch (err) {
    failed = true;
    out.push(`${label}: ❌ ${err.code || ""} ${String(err.message).split("\n")[0]}`);
  }
}

const ENTRIES = [
  "@ginkgolab/app-sdk",
  "@ginkgolab/models",
  "@ginkgolab/chart-spec",
  "@ginkgolab/datasources",
  "@ginkgolab/datasources/sqlGuard",
  "@ginkgolab/components/server",
  "@ginkgolab/harness-core",
  "@ginkgolab/harness-core/mcp",
  "@ginkgolab/sandbox",
  "@ginkgolab/llm",
];

for (const specifier of ENTRIES) {
  await check(specifier, async () => `${Object.keys(await import(specifier)).length} 个导出`);
}

const APPS = ["@ginkgolab/app-analytics", "@ginkgolab/app-design"];

for (const app of APPS) {
  await check(`${app}/manifest`, async () => {
    const mod = await import(`${app}/manifest`);
    const manifest =
      mod.analyticsManifest ??
      mod.designManifest ??
      Object.values(mod).find((v) => v && typeof v === "object" && typeof v.id === "string");
    if (!manifest?.id) throw new Error("manifest 未导出可识别的 id");
    return `id=${manifest.id}`;
  });

  await check(`${app}/server`, async () => `${Object.keys(await import(`${app}/server`)).length} 个导出`);

  await check(`${app}/definition`, async () => {
    const mod = await import(`${app}/definition`);
    const def = mod.default ?? Object.values(mod).find((v) => v?.manifest && v?.client);
    if (!def?.client?.welcomeMessage) throw new Error("应用定义缺少 client 契约");
    return `id=${def.manifest.id}，client.welcomeMessage 可读`;
  });

  await check(`${app} 根入口封禁`, async () => {
    try {
      await import(app);
      throw new Error("根入口仍可 import（应被封禁）");
    } catch (err) {
      if (err.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw err;
      return err.code;
    }
  });
}

console.log(out.join("\n"));
if (failed) process.exit(1);
