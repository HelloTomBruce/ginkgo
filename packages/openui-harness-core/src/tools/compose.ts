import type { CoreTool } from "ai";
import type { ToolExecutionContext, ToolInterceptor } from "./types";

/**
 * 将一组工具拦截器切面应用到 CoreTool 集合上，返回包装后的新工具集。
 * 无 execute 的纯声明式工具原样透传。
 */
export function composeToolInterceptors(
  tools: Record<string, CoreTool>,
  interceptors: ToolInterceptor[],
  getContext?: (toolName: string) => Partial<ToolExecutionContext>
): Record<string, CoreTool> {
  if (interceptors.length === 0) {
    return tools;
  }

  const wrapped: Record<string, CoreTool> = {};

  for (const [name, t] of Object.entries(tools)) {
    const orig = t as {
      execute?: (args: unknown, opts: unknown) => Promise<unknown>;
    };
    if (typeof orig.execute !== "function") {
      wrapped[name] = t;
      continue;
    }

    const origExecute = orig.execute.bind(t);

    wrapped[name] = {
      ...t,
      execute: async (args: unknown, callOpts: unknown) => {
        const extraCtx = getContext ? getContext(name) : {};
        const ctx: ToolExecutionContext = {
          toolName: name,
          ...extraCtx,
        };

        // 构造洋葱链路
        let index = -1;
        const dispatch = async (i: number, currentArgs: unknown): Promise<unknown> => {
          if (i <= index) {
            throw new Error("next() called multiple times in tool interceptor");
          }
          index = i;
          if (i === interceptors.length) {
            return origExecute(currentArgs, callOpts);
          }
          const interceptor = interceptors[i];
          return interceptor(currentArgs, ctx, (nextArgs) =>
            dispatch(i + 1, nextArgs !== undefined ? nextArgs : currentArgs)
          );
        };

        return dispatch(0, args);
      },
    } as CoreTool;
  }

  return wrapped;
}
