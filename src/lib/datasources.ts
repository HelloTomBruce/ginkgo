import path from "node:path";
import {
  createDatasourceManager,
  type DatasourceManager,
} from "@ginkgo/datasources";

const globalForDatasources = globalThis as unknown as {
  __ginkgo_datasources__?: DatasourceManager;
};

/** 应用级单例：挂载在 globalThis 防止 Next.js 开发环境热重载与路由分包产生多实例 */
export const datasources =
  globalForDatasources.__ginkgo_datasources__ ??
  createDatasourceManager({
    configPath: path.join(process.cwd(), "config", "datasources.json"),
    filesDir: path.join(process.cwd(), "data", "files"),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatasources.__ginkgo_datasources__ = datasources;
}
