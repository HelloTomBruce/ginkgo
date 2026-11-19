import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DatasourceSettings } from "./DatasourceSettings";
import { resetDatasourceCacheForTests, useDatasourceList } from "./useDatasources";

/** 探针：模拟 ChatDashboard 顶层的另一个 useDatasourceList 实例 */
function Probe() {
  const { sources } = useDatasourceList();
  return <div data-testid="probe-count">{sources.length}</div>;
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    json: async () => body,
  };
}

const SOURCES = [
  {
    id: "postgres",
    name: "PostgreSQL 分析库",
    kind: "db",
    dbType: "postgres",
    tools: [],
    enabled: true,
  },
  {
    id: "mysql-a",
    name: "订单库",
    kind: "db",
    tools: [],
    enabled: true,
    dbType: "mysql",
    maskedConnectionString: "mysql://u:***@h:3306/db",
  },
  {
    id: "clickhouse-b",
    name: "日志库",
    kind: "db",
    tools: [],
    enabled: false,
    dbType: "clickhouse",
    maskedConnectionString: "http://default:***@h:8123/default",
  },
  {
    id: "csv1",
    name: "销售表",
    kind: "file",
    tools: ["execute_sql", "list_tables", "describe_table"],
    enabled: true,
  },
];

const HEALTH = {
  postgres: { ok: true, latencyMs: 12 },
  "mysql-a": { ok: true, latencyMs: 8 },
  "clickhouse-b": { ok: false, latencyMs: 0, error: "down" },
  csv1: { ok: true, latencyMs: 1 },
};

function mockGetAll() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      return jsonResponse({ source: { id: "ok", name: "ok" }, manifest: { tables: [] } }, 201);
    }
    if (url === "/api/datasources/csv1/file") {
      return jsonResponse({
        manifest: {
          files: [{ name: "sales.csv", size: 10, uploadedAt: "t" }],
          tables: [
            { table: "sales", fromFile: "sales.csv", rowCount: 3, columns: [] },
          ],
          ingestedAt: "t",
        },
      });
    }
    if (url.includes("/api/datasources") && url.indexOf("/api/datasources/") === -1) {
      return jsonResponse({ sources: SOURCES, health: HEALTH });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });
}

function renderSettings() {
  return render(<DatasourceSettings />);
}

async function openCreateForm() {
  fireEvent.click(screen.getByRole("button", { name: /添加数据源/ }));
  await screen.findByLabelText(/ID/);
}

describe("DatasourceSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDatasourceCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mockGetAll();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("渲染数据源列表行：类型徽章 / 启停 / 编辑 / 删除", async () => {
    renderSettings();

    expect(await screen.findByText("PostgreSQL 分析库")).toBeInTheDocument();
    expect(screen.getByText("订单库")).toBeInTheDocument();
    expect(screen.getByText("日志库")).toBeInTheDocument();
    expect(screen.getByText("销售表")).toBeInTheDocument();

    // 动态源类型徽章
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.getByText("ClickHouse")).toBeInTheDocument();
    expect(screen.getByText("文件")).toBeInTheDocument();

    // 操作按钮
    expect(screen.getByRole("button", { name: /编辑 mysql-a/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除 mysql-a/ })).toBeInTheDocument();
  });

  it("添加数据源：切到 db 类型出现连接串字段，提交 POST 携带完整 body", async () => {
    renderSettings();
    await openCreateForm();

    fireEvent.change(screen.getByLabelText(/ID/), { target: { value: "pg-b" } });
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "报表库" } });
    fireEvent.click(screen.getByLabelText(/数据库连接/));
    await screen.findByLabelText(/连接串/);
    // 数据库类型默认 postgres
    expect(screen.getByLabelText(/数据库类型/)).toHaveTextContent(/PostgreSQL/);
    expect(screen.getByLabelText(/连接串/)).toHaveAttribute(
      "placeholder",
      "postgresql://user:pass@host:5432/db"
    );

    // 切换为 MySQL，占位符联动为 mysql://
    fireEvent.change(screen.getByLabelText(/数据库类型/), { target: { value: "mysql" } });
    expect(screen.getByLabelText(/连接串/)).toHaveAttribute(
      "placeholder",
      "mysql://user:pass@host:3306/db"
    );

    // 切换为 SQLite，占位符联动为 sqlite 路径
    fireEvent.change(screen.getByLabelText(/数据库类型/), { target: { value: "sqlite" } });
    expect(screen.getByLabelText(/连接串/)).toHaveAttribute(
      "placeholder",
      expect.stringContaining("sqlite")
    );

    // 切换为 ClickHouse，占位符联动为 http://
    fireEvent.change(screen.getByLabelText(/数据库类型/), { target: { value: "clickhouse" } });
    expect(screen.getByLabelText(/连接串/)).toHaveAttribute(
      "placeholder",
      "http://default:pass@host:8123/default"
    );

    // 切回 postgres
    fireEvent.change(screen.getByLabelText(/数据库类型/), { target: { value: "postgres" } });
    fireEvent.change(screen.getByLabelText(/连接串/), {
      target: { value: "postgres://u:p@h:5432/reports" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/datasources" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body as string);
      expect(body).toMatchObject({
        id: "pg-b",
        name: "报表库",
        kind: "db",
        dbType: "postgres",
        connectionString: "postgres://u:p@h:5432/reports",
      });
    });
  });

  it("编辑 db 源：连接串留空提交时 PATCH body 不含 connectionString", async () => {
    renderSettings();
    await screen.findByText("订单库");

    fireEvent.click(screen.getByRole("button", { name: /编辑 mysql-a/ }));
    await screen.findByLabelText(/连接串/);
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "订单库 2" } });
    // 清空连接串
    fireEvent.change(screen.getByLabelText(/连接串/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/datasources/mysql-a" && c[1]?.method === "PATCH"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body as string);
      expect(body).not.toHaveProperty("connectionString");
      expect(body.name).toBe("订单库 2");
    });
  });

  it("启停 toggle 发送 PATCH {enabled}", async () => {
    renderSettings();
    await screen.findByText("日志库");

    fireEvent.click(screen.getByRole("button", { name: /启停 clickhouse-b/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/datasources/clickhouse-b" &&
          c[1]?.method === "PATCH"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body as string)).toEqual({ enabled: true });
    });
  });

  it("删除动态源发送 DELETE 并移除行", async () => {
    let deleted = false;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return { status: 204 };
      }
      return jsonResponse({
        sources: deleted ? SOURCES.filter((s) => s.id !== "mysql-a") : SOURCES,
        health: HEALTH,
      });
    });
    renderSettings();
    await screen.findByText("订单库");

    fireEvent.click(screen.getByRole("button", { name: /删除 mysql-a/ }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) => String(c[0]) === "/api/datasources/mysql-a" && c[1]?.method === "DELETE"
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText("订单库")).not.toBeInTheDocument();
    });
  });

  it("再次打开时命中缓存立即渲染，不重新整屏 loading", async () => {
    // 第一次挂载填充模块级缓存
    const first = renderSettings();
    expect(await first.findByText("订单库")).toBeInTheDocument();
    first.unmount();

    // 第二次挂载：GET 挂起未返回，列表应同步来自缓存
    fetchMock.mockImplementation(
      () => new Promise(() => {}) // 永不 resolve，隔离网络
    );
    renderSettings();
    expect(screen.getByText("订单库")).toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  it("启停按钮点击后立即 loading 并禁用，请求完成后恢复", async () => {
    let resolvePatch!: (v: unknown) => void;
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Promise((res) => {
            resolvePatch = res;
          });
        }
        const url = String(input);
        if (url.includes("/api/datasources/")) return jsonResponse({ error: "" }, 500);
        return jsonResponse({ sources: SOURCES, health: HEALTH });
      }
    );
    renderSettings();
    const btn = await screen.findByRole("button", { name: /启停 clickhouse-b/ });

    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("aria-busy", "true");
    resolvePatch(jsonResponse({ source: SOURCES[2] }, 200));
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("删除按钮点击后立即 loading 并禁用，请求完成后恢复", async () => {
    let resolveDelete!: (v: unknown) => void;
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return new Promise((res) => {
            resolveDelete = res;
          });
        }
        const url = String(input);
        if (url.includes("/api/datasources/")) return jsonResponse({ error: "" }, 500);
        return jsonResponse({ sources: SOURCES, health: HEALTH });
      }
    );
    renderSettings();
    const btn = await screen.findByRole("button", { name: /删除 mysql-a/ });

    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("aria-busy", "true");
    resolveDelete({ status: 204 });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("设置面板删除数据源后，其它 useDatasourceList 实例（如底部计数）实时同步", async () => {
    let deleted = false;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return { status: 204 };
      }
      return jsonResponse({
        sources: deleted ? SOURCES.filter((s) => s.id !== "mysql-a") : SOURCES,
        health: HEALTH,
      });
    });
    render(
      <>
        <Probe />
        <DatasourceSettings />
      </>
    );
    const probe = screen.getByTestId("probe-count");
    await waitFor(() => expect(probe).toHaveTextContent(String(SOURCES.length)));

    fireEvent.click(screen.getByRole("button", { name: /删除 mysql-a/ }));

    await waitFor(() => expect(probe).toHaveTextContent(String(SOURCES.length - 1)));
  });

  it("POST 400 时展示服务端错误列表", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return jsonResponse({ errors: ["id 非法（需匹配 ^[a-z][a-z0-9-]{0,31}$）: \"BAD\""] }, 400);
      }
      if (url.includes("/api/datasources/")) return jsonResponse({ error: "" }, 500);
      return jsonResponse({ sources: SOURCES, health: HEALTH });
    });
    renderSettings();
    await openCreateForm();

    fireEvent.change(screen.getByLabelText(/ID/), { target: { value: "BAD" } });
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText(/数据库连接/));
    fireEvent.change(screen.getByLabelText(/连接串/), { target: { value: "postgres://u:p@h:5432/db" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    expect(await screen.findByText(/id 非法/)).toBeInTheDocument();
  });

  it("文件源行：类型徽章与上传面板（manifest 表清单）", async () => {
    renderSettings();

    expect(await screen.findByText("销售表")).toBeInTheDocument();
    expect(screen.getByText("文件")).toBeInTheDocument();
    // 上传面板加载 manifest 后显示表清单
    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(screen.getByText(/3 行/)).toBeInTheDocument();
  });

  it("添加文件源：仅需 id/name，提交 kind=file 无额外字段", async () => {
    renderSettings();
    await openCreateForm();

    fireEvent.change(screen.getByLabelText(/ID/), { target: { value: "csv2" } });
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "用户表" } });
    fireEvent.click(screen.getByLabelText(/文件（CSV\/Excel\/Parquet\/JSON）/));
    // 文件类型不渲染连接字段
    expect(screen.queryByLabelText(/连接串/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/datasources" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body as string);
      expect(body).toEqual({ id: "csv2", name: "用户表", kind: "file" });
    });
  });

  it("添加文件源时支持直接选择文件并完成上传", async () => {
    renderSettings();
    await openCreateForm();

    fireEvent.click(screen.getByLabelText(/文件（CSV\/Excel\/Parquet\/JSON）/));
    expect(screen.getByText(/点击选择文件 或 拖拽文件到此处/)).toBeInTheDocument();

    const file = new File(["a,b\n1,2"], "orders.csv", { type: "text/csv" });
    const dialog = screen.getByRole("dialog");
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    // 选中文件后自动以文件名填充名称与 id
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText("orders.csv")).toBeInTheDocument();
    expect(screen.getByLabelText(/名称/)).toHaveValue("orders");

    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      // 验证先调用了 POST /api/datasources
      const postSource = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/datasources" && c[1]?.method === "POST"
      );
      expect(postSource).toBeTruthy();
      // 验证紧接着调用了 POST /api/datasources/<id>/file 上传文件
      const postFile = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("/file") && c[1]?.method === "POST"
      );
      expect(postFile).toBeTruthy();
    });
  });

  it("编辑 db 源：连接串正确回显，支持弹窗取消关闭", async () => {
    renderSettings();
    await screen.findByText("订单库");

    fireEvent.click(screen.getByRole("button", { name: /编辑 mysql-a/ }));
    const connInput = await screen.findByLabelText(/连接串/);
    // 连接串正确回显脱敏值（或明文值）
    expect(connInput).toHaveValue("mysql://u:***@h:3306/db");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/编辑数据源（订单库）/)).toBeInTheDocument();

    // 点击取消关闭弹窗
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("编辑 db 源：修改连接串并提交时 PATCH body 携带新 connectionString", async () => {
    renderSettings();
    await screen.findByText("订单库");

    fireEvent.click(screen.getByRole("button", { name: /编辑 mysql-a/ }));
    const connInput = await screen.findByLabelText(/连接串/);
    fireEvent.change(connInput, {
      target: { value: "mysql://root:secret@127.0.0.1:3306/new_orders" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/datasources/mysql-a" && c[1]?.method === "PATCH"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body as string);
      expect(body).toMatchObject({
        connectionString: "mysql://root:secret@127.0.0.1:3306/new_orders",
      });
    });
  });

  it("编辑 db 源：修改连接串但保留脱敏星号(***)时拦截并报错", async () => {
    renderSettings();
    await screen.findByText("订单库");

    fireEvent.click(screen.getByRole("button", { name: /编辑 mysql-a/ }));
    const connInput = await screen.findByLabelText(/连接串/);
    fireEvent.change(connInput, {
      target: { value: "mysql://u:***@newhost:3306/db" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    expect(
      await screen.findByText(/连接串包含脱敏星号\(.*?\)，若修改连接串请填入完整密码/)
    ).toBeInTheDocument();

    // 不应发送 PATCH 请求
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/datasources/mysql-a" && c[1]?.method === "PATCH"
    );
    expect(call).toBeUndefined();
  });
});
