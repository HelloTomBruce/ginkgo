import { createParser, type Library } from "@openuidev/lang-core";

/**
 * 与 @ginkgolab/harness-core 的 StructureValidator 契约结构兼容的本地声明
 * （组件包不引入 harness-core 依赖；结构类型在赋值处自动兼容）。
 */
export interface ValidationResult<T = unknown> {
  ok: boolean;
  data?: T;
  errors: string[];
}

export interface StructureValidator<T = unknown> {
  readonly name: string;
  validate(content: string): ValidationResult<T>;
  buildFixPrompt(content: string, errors: string[]): string;
}

/**
 * UiSpec DSL 看板代码块语法验证器：
 * 预检 ```ginkgo 代码块是否符合指定组件库的 AST Schema 规范。
 *
 * 工厂形式（createUiSpecDslValidator）接收任意 UiSpec Library，
 * 不绑定具体组件集——校验器属于平台 DSL 设施，组件集由应用/宿主决定。
 */
export class UiSpecDslValidator implements StructureValidator<unknown> {
  readonly name = "UiSpecDslValidator";
  private readonly parser: ReturnType<typeof createParser>;

  constructor(library: Library) {
    this.parser = createParser(library.toJSONSchema(), "Root");
  }

  validate(content: string): ValidationResult<unknown> {
    if (!content || !content.includes("```ginkgo")) {
      return { ok: true, errors: [] };
    }

    const blockRe = /```ginkgo\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    const errors: string[] = [];
    let parsedCount = 0;

    while ((match = blockRe.exec(content)) !== null) {
      const code = match[1].trim();
      if (!code) continue;
      parsedCount++;

      try {
        const result = this.parser.parse(code);
        if (result.meta?.errors && result.meta.errors.length > 0) {
          for (const err of result.meta.errors) {
            errors.push(typeof err === "string" ? err : JSON.stringify(err));
          }
        }
        if (!result.root) {
          errors.push("未解析出合法的 Root 根节点");
        }
      } catch (err) {
        errors.push(`DSL 解析异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (parsedCount > 0 && errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true, errors: [] };
  }

  buildFixPrompt(content: string, errors: string[]): string {
    return [
      "The generated ```ginkgo code block has syntax errors preventing it from rendering:",
      ...errors.map((e) => `- ${e}`),
      "",
      "Please fix the syntax strictly. Ensure that:",
      "1. All parenthesis, brackets, and quotes are properly closed.",
      "2. Only valid components and props defined in the library schema are used.",
      "3. The code block starts with ```ginkgo and ends with ```.",
      "Output ONLY the corrected markdown text with the fixed ```ginkgo code block.",
    ].join("\n");
  }
}

/** 便捷工厂：基于传入 Library 构建校验器实例 */
export function createUiSpecDslValidator(library: Library): UiSpecDslValidator {
  return new UiSpecDslValidator(library);
}
