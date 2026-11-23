import type { SandboxToolsPreset, SandboxPermission } from "./tools";

/**
 * 沙箱工具说明 prompt 片段：随 preset / permission 变化，由应用拼进自己的
 * system prompt（须与其装配 createSandboxTools 时的参数同源判定）。
 * 刻意精简（原子工具哲学）：不为每类操作写用法说教——工具参数 schema 对模型
 * 完整可见（zodTool），检索/Git/测试等组合用法模型在后训练阶段已充分掌握。
 */
export function sandboxToolsPromptSection(
  preset: SandboxToolsPreset,
  permission: SandboxPermission = "full"
): string {
  const lines = ["## 沙箱工作区"];
  if (permission === "readonly") {
    lines.push(
      "当前处于规划阶段，工作区只读：仅提供 `read_file`（大文件用 startLine/endLine 切片）" +
        (preset === "explorer" ? "与 `list_dir` 目录浏览" : "") +
        "。此阶段请聚焦产出方案，不要尝试写入或执行命令；方案经用户确认后，写入与命令执行能力会自动解锁。"
    );
    return lines.join("\n");
  }
  lines.push(
    "你拥有当前会话的专属工作区沙箱，配备了以下原子工具：",
    "- `read_file` / `write_file` / `edit_file`：沙箱内文件的读取、写入与精准替换（大文件用 startLine/endLine 切片）；",
    "- `run_command`：在沙箱目录执行 Shell 命令（ls / find / rg / git / 测试与构建等皆经它组合完成）。"
  );
  if (preset === "explorer") {
    lines.push("- `list_dir`：目录树只读浏览（自动过滤 node_modules 等无关目录）。");
  }
  lines.push("需要产出或验证文件时主动使用这些工具；完成后向用户简要总结交付成果。");
  return lines.join("\n");
}
