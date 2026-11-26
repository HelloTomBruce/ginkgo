import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      client: "src/client/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    target: "es2022",
    external: ["react", "react-dom", "lucide-react", "zod", "@ginkgo/app-sdk"],
    noExternal: ["@ginkgo/harness-core", "@ginkgo/sandbox"],
    banner: {
      js: '"use client";',
    },
  },
  {
    entry: {
      server: "src/server/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    target: "es2022",
    external: ["react", "react-dom", "lucide-react", "zod", "@ginkgo/app-sdk"],
    noExternal: ["@ginkgo/harness-core", "@ginkgo/sandbox"],
  },
]);
