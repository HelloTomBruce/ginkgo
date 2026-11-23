// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CrossSourceSettings } from "./CrossSourceSettings";

interface Mapping {
  projectSource: string;
  project: string;
  projectName?: string;
  repoSource: string;
  repo: string;
}

const SOURCES = [
  { id: "zentao-cli", name: "禅道", enabled: true },
  { id: "gitlab", name: "GitLab", enabled: false },
];

const MAPPING: Mapping = {
  projectSource: "zentao-cli",
  project: "42",
  projectName: "交易平台重构",
  repoSource: "gitlab",
  repo: "backend/trading-platform",
};

let state: { mappings: Mapping[] };
/** PUT 的可注入失败响应（status + body）；null = 成功 */
let putFailure: { status: number; body: unknown } | null;
const request = vi.fn();

function payload() {
  return {
    mappings: state.mappings,
    sources: SOURCES,
    active: false,
  };
}

function asResponse(body: unknown, status: number): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

/** 最近一次 PUT 提交的全量清单 */
function lastPutBody(): { mappings: Mapping[] } {
  const call = request.mock.calls.findLast(([, init]) => init?.method === "PUT");
  if (!call) throw new Error("未发起 PUT");
  return JSON.parse(String(call[1]?.body)) as { mappings: Mapping[] };
}

beforeEach(() => {
  state = { mappings: [MAPPING] };
  putFailure = null;
  request.mockReset();
  request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      if (putFailure) return asResponse(putFailure.body, putFailure.status);
      const body = JSON.parse(String(init?.body)) as { mappings: Mapping[] };
      state = { mappings: body.mappings };
    }
    return asResponse(payload(), 200);
  });
});

afterEach(() => {
  cleanup();
});

function renderSection(props: Partial<Parameters<typeof CrossSourceSettings>[0]> = {}) {
  return render(<CrossSourceSettings appId="analytics" request={request} {...props} />);
}

/** 打开新增表单并填入四个必填项（默认合法，可用 values 覆盖个别字段） */
function fillCreateForm(values: Partial<Mapping> = {}) {
  fireEvent.click(screen.getByRole("button", { name: "添加映射" }));
  fireEvent.change(screen.getByLabelText("项目管理侧数据源"), {
    target: { value: values.projectSource ?? "zentao-cli" },
  });
  fireEvent.change(screen.getByLabelText("项目标识"), {
    target: { value: values.project ?? "43" },
  });
  fireEvent.change(screen.getByLabelText("代码仓库侧数据源"), {
    target: { value: values.repoSource ?? "gitlab" },
  });
  fireEvent.change(screen.getByLabelText("仓库路径"), {
    target: { value: values.repo ?? "backend/checkout" },
  });
}

describe("CrossSourceSettings 跨源映射分区", () => {
  it("加载后列出映射两侧，并展示服务端判定的能力状态与停用源提示", async () => {
    renderSection();

    expect(await screen.findByText("backend/trading-platform")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("交易平台重构")).toBeInTheDocument();
    expect(screen.getByText("zentao-cli")).toBeInTheDocument();
    expect(screen.getByText("gitlab")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("未开启");
    // gitlab 已配置但停用；zentao-cli 启用 → 只有一处停用提示
    expect(screen.getAllByText("已停用")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/api/cross-source");
  });

  it("无映射时展示空态", async () => {
    state = { mappings: [] };
    renderSection();

    expect(await screen.findByText("暂无映射")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加映射" })).toBeInTheDocument();
  });

  it("添加映射：提交全量清单（字段去空白），成功后以回传刷新并关闭表单", async () => {
    renderSection();
    await screen.findByText("backend/trading-platform");

    fillCreateForm({ project: " 43 ", repoSource: " gitlab " });
    fireEvent.change(screen.getByLabelText("项目名称（可选）"), {
      target: { value: "结算中心" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByLabelText("项目标识")).toBeNull());
    expect(lastPutBody()).toEqual({
      mappings: [MAPPING, {
        projectSource: "zentao-cli",
        project: "43",
        projectName: "结算中心",
        repoSource: "gitlab",
        repo: "backend/checkout",
      }],
    });
    expect(screen.getByText("backend/checkout")).toBeInTheDocument();
    expect(screen.getByText("结算中心")).toBeInTheDocument();
  });

  it("可选的项目名称留空时不提交该字段", async () => {
    renderSection();
    await screen.findByText("backend/trading-platform");

    fillCreateForm();
    fireEvent.change(screen.getByLabelText("项目名称（可选）"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByLabelText("项目标识")).toBeNull());
    expect(lastPutBody().mappings[1]).toEqual({
      projectSource: "zentao-cli",
      project: "43",
      repoSource: "gitlab",
      repo: "backend/checkout",
    });
  });

  it("必填项为空时本地拦截，不发起保存请求", async () => {
    renderSection();
    await screen.findByText("backend/trading-platform");

    fillCreateForm({ repo: "" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert")).toHaveTextContent("均不能为空");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("服务端校验失败：展示逐条 errors，表单保持打开", async () => {
    putFailure = {
      status: 400,
      body: {
        errors: [
          "第 2 条映射：项目 42（源 zentao-cli）重复映射，同一项目只能对应一个仓库",
        ],
      },
    };
    renderSection();
    await screen.findByText("backend/trading-platform");

    fillCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText(/重复映射，同一项目只能对应一个仓库/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("项目标识")).toBeInTheDocument();
    // 清单未被改动
    expect(screen.getAllByText("backend/trading-platform")).toHaveLength(1);
  });

  it("保存请求本身失败（网络异常）：错误信息可见", async () => {
    request.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("Failed to fetch");
      return asResponse(payload(), 200);
    });
    renderSection();
    await screen.findByText("backend/trading-platform");

    fillCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/Failed to fetch/)).toBeInTheDocument();
  });

  it("编辑映射：表单回填原值，保存后只替换对应条目", async () => {
    renderSection();
    await screen.findByText("backend/trading-platform");

    fireEvent.click(screen.getByRole("button", { name: "编辑映射 1" }));
    expect(screen.getByLabelText("项目标识")).toHaveValue("42");
    expect(screen.getByLabelText("项目名称（可选）")).toHaveValue("交易平台重构");

    fireEvent.change(screen.getByLabelText("仓库路径"), {
      target: { value: "backend/trading" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByLabelText("项目标识")).toBeNull());
    expect(lastPutBody()).toEqual({
      mappings: [{ ...MAPPING, repo: "backend/trading" }],
    });
    expect(screen.getByText("backend/trading")).toBeInTheDocument();
    expect(screen.queryByText("backend/trading-platform")).toBeNull();
  });

  it("删除走行内二次确认：取消不发请求，确认后提交剔除该条的清单", async () => {
    renderSection();
    await screen.findByText("backend/trading-platform");

    fireEvent.click(screen.getByRole("button", { name: "删除映射 1" }));
    expect(screen.getByText("确认删除？")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("确认删除？")).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "删除映射 1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除映射 1" }));

    await waitFor(() => expect(screen.getByText("暂无映射")).toBeInTheDocument());
    expect(lastPutBody()).toEqual({ mappings: [] });
  });

  it("加载失败展示错误与重试；重试成功后渲染清单", async () => {
    let fail = true;
    request.mockImplementation(async () => {
      if (fail) return asResponse(null, 500);
      return asResponse(payload(), 200);
    });
    renderSection();

    expect(await screen.findByText("加载失败：HTTP 500")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加映射" })).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("backend/trading-platform")).toBeInTheDocument();
  });

  it("宿主每次渲染传入新的 request 引用时，不会重复取数", async () => {
    const { rerender } = renderSection();
    await screen.findByText("backend/trading-platform");
    const gets = () => request.mock.calls.filter(([, init]) => !init?.method).length;
    expect(gets()).toBe(1);

    for (let i = 0; i < 3; i++) {
      rerender(<CrossSourceSettings appId="analytics" request={vi.fn()} />);
    }

    expect(gets()).toBe(1);
  });
});
