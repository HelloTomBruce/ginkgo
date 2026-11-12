"use client";

import React, { useMemo, useState, useEffect } from "react";
import { Search, ArrowUpDown, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { toCsvContent, downloadCsv } from "../internal/csv";
import { parseArrayProp } from "../internal/parseProp";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";
import { onFilterChange, useDashboardScope, getFilterState } from "../charts/filterBus";


export interface ColumnConfig {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  format?: "number" | "currency" | "percent" | "text";
}

export interface DataTableProps {
  title?: string;
  columns?: ColumnConfig[];
  data?: Array<Record<string, unknown>>;
  searchable?: boolean;
  /** 每页显示行数（默认 20，传 0 或负数关闭分页）；导出 CSV 仍导出全量数据 */
  pageSize?: number;
  /** 是否启用 filterBus 响应式联动切片（默认 true；嵌入 SpecChart 等由父级接管筛选的场景传 false 避免双重过滤） */
  interactiveFilter?: boolean;
  /** 单元格样式钩子（如阈值条件着色）；返回 undefined 用默认样式 */
  cellStyle?: (
    row: Record<string, unknown>,
    col: ColumnConfig
  ) => React.CSSProperties | undefined;
}

export const DataTable: React.FC<DataTableProps> = ({
  title,
  columns = [],
  data = [],
  searchable = true,
  pageSize = 20,
  interactiveFilter = true,
  cellStyle,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  // 安全容错：确保 data 与 columns 始终为有效数组且元素为非空对象
  const safeData: Array<Record<string, unknown>> = useMemo(() => parseArrayProp(data), [data]);

  const safeColumns: ColumnConfig[] = useMemo(() => {
    let cols = parseArrayProp(columns).filter(
      (c) => typeof c.key === "string"
    ) as unknown as ColumnConfig[];

    // 若未指定 columns，自动根据数据行推断表头
    if (cols.length === 0 && safeData.length > 0 && safeData[0] && typeof safeData[0] === "object") {
      cols = Object.keys(safeData[0]).map((k) => ({
        key: k,
        header: k,
      }));
    }
    return cols;
  }, [columns, safeData]);

  const scopeId = useDashboardScope();
  // 响应式筛选联动（全量响应 filterBus 广播并同步初始 scope 状态）
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() =>
    interactiveFilter ? getFilterState(scopeId) : {}
  );
  const [prevFilterValues, setPrevFilterValues] = useState(filterValues);
  const [prevSearchTerm, setPrevSearchTerm] = useState(searchTerm);

  // 搜索词或外部筛选变化时自动复位到第一页（遵循 React 官方 Adjusting state during render 最佳实践）
  if (prevFilterValues !== filterValues || prevSearchTerm !== searchTerm) {
    setPrevFilterValues(filterValues);
    setPrevSearchTerm(searchTerm);
    setCurrentPage(1);
  }

  useEffect(() => {
    if (!interactiveFilter) return;
    return onFilterChange((event) => {
      setFilterValues((prev) => {
        if (event.value === "") {
          const next = { ...prev };
          delete next[event.field];
          return next;
        }
        return { ...prev, [event.field]: event.value };
      });
    }, scopeId);
  }, [interactiveFilter, scopeId]);

  // 搜索/排序派生数据 memo 化：结合外部 filterBus 与内部搜索词重算
  const filteredData = useMemo(() => {
    const filterKeys = Object.keys(filterValues);
    return safeData.filter((row) => {
      if (!row || typeof row !== "object") return false;
      // 外部 filterBus 字段过滤（严格排他，缺失或空值不穿透）
      for (const key of filterKeys) {
        if (row[key] === undefined || row[key] === null) {
          return false;
        }
        if (String(row[key]) !== String(filterValues[key])) {
          return false;
        }
      }
      // 内部前端搜索词过滤
      if (!searchTerm) return true;
      return Object.values(row).some((val) =>
        val != null && String(val).toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [safeData, filterValues, searchTerm]);

  const sortedData = useMemo(
    () =>
      [...filteredData].sort((a, b) => {
        if (!sortKey) return 0;
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal === bVal) return 0;
        if (aVal == null) return sortAsc ? 1 : -1;
        if (bVal == null) return sortAsc ? -1 : 1;
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortAsc ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal);
        const bStr = String(bVal);
        return sortAsc ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      }),
    [filteredData, sortKey, sortAsc]
  );

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  const paginatedData = useMemo(() => {
    if (pageSize <= 0) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const exportCSV = () => {
    const headers = safeColumns.map((c) => c.header);
    const rows = sortedData.map((row) => safeColumns.map((c) => row[c.key]));
    downloadCsv(title || "export", toCsvContent(headers, rows));
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
      {(title || searchable) && (
        <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h4 className="text-sm font-semibold text-foreground">
              {title}
            </h4>
          )}
          <div className="flex items-center gap-2 ms-auto">
            {searchable && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-faint" />
                <input
                  type="text"
                  placeholder="搜索数据..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface-sunken focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
            <button
              onClick={exportCSV}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
              title="导出 CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-surface-sunken dark:bg-surface-inverse/60 text-muted-foreground border-b border-border">
            <tr>
              {safeColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`p-3 font-semibold cursor-pointer hover:bg-muted transition-colors ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                      ? "text-center"
                      : "text-left"
                  }`}
                >
                  <div
                    className={`inline-flex items-center gap-1 ${
                      col.align === "right" ? "justify-end" : ""
                    }`}
                  >
                    <span>{col.header}</span>
                    <ArrowUpDown className="w-3 h-3 text-foreground-faint" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle text-foreground-subtle">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={Math.max(safeColumns.length, 1)} className="p-4 text-center text-foreground-faint">
                  暂无匹配数据
                </td>
              </tr>
            ) : (
              paginatedData.map((row, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-surface-sunken/80 transition-colors"
                >
                  {safeColumns.map((col) => (
                    <td
                      key={col.key}
                      style={cellStyle?.(row, col)}
                      className={`p-3 ${
                        col.align === "right"
                          ? "text-right font-mono"
                          : col.align === "center"
                          ? "text-center"
                          : "text-left"
                      }`}
                    >
                      {row[col.key] != null ? String(row[col.key]) : "-"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页控制栏 */}
      {pageSize > 0 && totalPages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-foreground-subtle bg-surface-sunken/40">
          <div>
            共 <span className="font-medium text-foreground">{sortedData.length}</span> 条数据，第{" "}
            <span className="font-medium text-foreground">{currentPage}</span> / {totalPages} 页
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded-md border border-border bg-card text-foreground-subtle hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="上一页"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1 rounded-md border border-border bg-card text-foreground-subtle hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="下一页"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const DataTableDef = defineComponent({
  name: "DataTable",
  description: "交互式明细数据表格，支持前端搜索、列排序和一键导出CSV",
  props: z.object({
    title: z.any().optional().describe("表格标题"),
    columns: z.any().optional().describe("表头定义或数据数组"),
    data: z.any().optional().describe("行数据数组"),
    searchable: z.any().optional().describe("是否启用搜索框"),
    queryId: z.any().optional().describe("可选的绑定查询 ID"),
    pageSize: z.any().optional().describe("每页条数（默认20，0关闭分页）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = props?.title ? String(props.title) : undefined;
    let columns = props?.columns;
    let data = props?.data;
    const pageSize = typeof props?.pageSize === "number" ? props.pageSize : 20;

    // 容错：如果用户写成 DataTable("标题", data)，2nd 参数为数组时自动处理
    if (Array.isArray(columns) && (!data || !Array.isArray(data))) {
      if (columns.length > 0 && typeof columns[0] === "object" && !("header" in columns[0] && "key" in columns[0])) {
        data = columns;
        columns = undefined;
      }
    }

    return (
      <ComponentSafeWrapper name="DataTable">
        <DataTable
          title={title}
          columns={columns as React.ComponentProps<typeof DataTable>["columns"]}
          data={data as React.ComponentProps<typeof DataTable>["data"]}
          searchable={props?.searchable !== false}
          pageSize={pageSize}
        />
      </ComponentSafeWrapper>
    );
  },
});
