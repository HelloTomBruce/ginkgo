import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
    // VitePress 文档站构建产物与缓存（源码 config/theme 仍参与检查）
    "docs/.vitepress/dist/**",
    "docs/.vitepress/cache/**",
  ]),
  // 主题护栏：业务代码禁止硬编码 Tailwind 色板类（如 bg-slate-50、
  // dark:text-blue-400）。颜色一律使用 globals.css 中的语义 token，
  // 见 docs/theme-tokens.md。豁免：icon.tsx（favicon 静态 artwork）。
  {
    files: ["src/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    ignores: ["src/app/icon.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(?:^|\\s)(?:[a-z-]+:)*(?:bg|text|border|ring|divide|outline|placeholder|accent|caret|decoration|shadow|from|via|to|stroke|fill)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/]",
          message:
            "禁止硬编码色板类，请使用 globals.css 的语义 token（见 docs/theme-tokens.md）",
        },
        {
          selector:
            "TemplateElement[value.raw=/(?:^|\\s)(?:[a-z-]+:)*(?:bg|text|border|ring|divide|outline|placeholder|accent|caret|decoration|shadow|from|via|to|stroke|fill)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/]",
          message:
            "禁止硬编码色板类，请使用 globals.css 的语义 token（见 docs/theme-tokens.md）",
        },
      ],
    },
  },
]);

export default eslintConfig;
