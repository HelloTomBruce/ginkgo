import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ginkgo - 对话式智能数据分析看板",
  description: "基于 Vercel AI SDK、声明式生成式看板规范与 PostgreSQL MCP Server 的新一代生成式商业智能数据分析平台",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
