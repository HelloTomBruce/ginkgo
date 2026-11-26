import {
  createDatasourceManager,
  type DatasourceManager,
} from "@ginkgo/datasources";
import {
  getDatasourcesConfigFile,
  getFileStorageDir,
} from "@/lib/storagePaths";

const globalForDatasources = globalThis as unknown as {
  __ginkgo_datasources__?: DatasourceManager;
};

/** 应用级单例：挂载在 globalThis 防止 Next.js 开发环境热重载与路由分包产生多实例 */
export const datasources =
  globalForDatasources.__ginkgo_datasources__ ??
  createDatasourceManager({
    configPath: getDatasourcesConfigFile(),
    filesDir: getFileStorageDir(),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatasources.__ginkgo_datasources__ = datasources;
}
