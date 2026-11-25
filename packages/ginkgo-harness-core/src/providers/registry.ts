/**
 * @ginkgo/harness-core - providers/registry
 * 统一委托并 re-export 来自 `@ginkgo/models` 的真值元数据与方法。
 */

export {
  DEFAULT_MODEL_WINDOW_MAP,
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_CONTEXT_WINDOW,
  type ReasoningEffort,
  isReasoningModel,
  type ModelCatalog,
  ModelCatalogRegistry,
  defaultModelCatalog,
  resolveContextWindow,
} from "@ginkgo/models";
