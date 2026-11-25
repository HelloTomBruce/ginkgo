import { NextResponse } from "next/server";

export interface ModelProbeRequestBody {
  baseURL?: string;
  apiKey?: string;
  protocol?: "openai" | "anthropic";
  model?: string;
}

export async function POST(req: Request) {
  const startTime = Date.now();
  try {
    const body = (await req.json()) as ModelProbeRequestBody;
    const { baseURL, apiKey = "", protocol = "openai", model = "" } = body;

    if (!baseURL || typeof baseURL !== "string" || !baseURL.trim()) {
      return NextResponse.json(
        { ok: false, latencyMs: 0, error: "缺少或非法的 API 地址 (baseURL)" },
        { status: 400 }
      );
    }

    const cleanBaseURL = baseURL.trim().replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const candidateUrls: string[] = [];

    if (protocol === "anthropic") {
      if (apiKey.trim()) {
        headers["x-api-key"] = apiKey.trim();
        headers["anthropic-version"] = "2023-06-01";
      }
      if (cleanBaseURL.endsWith("/models")) {
        candidateUrls.push(cleanBaseURL);
      } else if (cleanBaseURL.endsWith("/v1")) {
        candidateUrls.push(`${cleanBaseURL}/models`);
      } else {
        // 未带 /v1 的端点优先尝试标准 /v1/models（如 Kimi Coding、Anthropic 等）
        candidateUrls.push(`${cleanBaseURL}/v1/models`);
        candidateUrls.push(`${cleanBaseURL}/models`);
      }
    } else {
      if (apiKey.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      }
      if (cleanBaseURL.endsWith("/models")) {
        candidateUrls.push(cleanBaseURL);
      } else if (cleanBaseURL.endsWith("/v1")) {
        candidateUrls.push(`${cleanBaseURL}/models`);
        candidateUrls.push(`${cleanBaseURL.replace(/\/v1$/, "")}/models`);
      } else {
        // 未带 /v1 的端点优先尝试 /v1/models（如 OpenAI、DeepSeek 等），次选根路径 /models
        candidateUrls.push(`${cleanBaseURL}/v1/models`);
        candidateUrls.push(`${cleanBaseURL}/models`);
      }
    }

    let lastStatus = 0;
    let lastError = "";

    // 1. 优先尝试探测 GET /models 或 /v1/models
    for (const targetUrl of candidateUrls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;
        const latencyMs = Math.max(1, Date.now() - startTime);

        if (response.ok) {
          return NextResponse.json({
            ok: true,
            latencyMs,
            status: response.status,
            message: `连接成功 (${latencyMs}ms)`,
          });
        }

        // 解析服务端返回的错误信息
        const errText = await response.text().catch(() => "");
        let errMsg = "";
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson?.error?.message || errJson?.message || "";
        } catch {
          // ignore
        }

        if (response.status === 401 || response.status === 403) {
          return NextResponse.json({
            ok: false,
            latencyMs,
            status: response.status,
            error: errMsg || `API 密钥未授权或已失效 (HTTP ${response.status})`,
          });
        }

        lastError = errMsg || `HTTP ${response.status}`;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const isAbort = (err as Error)?.name === "AbortError";
        lastError = isAbort
          ? "请求端点超时 (6s)，请检查 API 地址或代理设置"
          : ((err as Error)?.message || "网络请求异常");
      }
    }

    // 2. 若端点未暴露 GET /models (404/405)，尝试针对对话端点发轻量探针 (POST /messages 或 /chat/completions)
    if (lastStatus === 404 || lastStatus === 405) {
      const fallbackUrl =
        protocol === "anthropic"
          ? (cleanBaseURL.endsWith("/v1")
              ? `${cleanBaseURL}/messages`
              : `${cleanBaseURL}/v1/messages`)
          : (cleanBaseURL.endsWith("/v1")
              ? `${cleanBaseURL}/chat/completions`
              : `${cleanBaseURL}/v1/chat/completions`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const bodyPayload =
          protocol === "anthropic"
            ? {
                model: model || "claude-3-5-sonnet-20241022",
                max_tokens: 1,
                messages: [{ role: "user", content: "ping" }],
              }
            : {
                model: model || "gpt-4o-mini",
                max_tokens: 1,
                messages: [{ role: "user", content: "ping" }],
              };

        const response = await fetch(fallbackUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Math.max(1, Date.now() - startTime);

        if (response.ok) {
          return NextResponse.json({
            ok: true,
            latencyMs,
            status: response.status,
            message: `连接成功 (${latencyMs}ms)`,
          });
        }

        const errText = await response.text().catch(() => "");
        let errMsg = "";
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson?.error?.message || errJson?.message || "";
        } catch {
          // ignore
        }

        if (response.status === 401 || response.status === 403) {
          return NextResponse.json({
            ok: false,
            latencyMs,
            status: response.status,
            error: errMsg || `API 密钥未授权或已失效 (HTTP ${response.status})`,
          });
        }

        // 400 Bad Request 说明网络可达且已通过鉴权认证（仅模型 ID 或参数需对应）
        if (response.status === 400) {
          return NextResponse.json({
            ok: true,
            latencyMs,
            status: 200,
            message: `连接成功 (${latencyMs}ms)`,
          });
        }

        lastStatus = response.status;
        lastError = errMsg || `HTTP ${response.status}`;
      } catch {
        clearTimeout(timeoutId);
      }
    }

    const latencyMs = Math.max(1, Date.now() - startTime);
    const friendlyError =
      lastStatus === 404
        ? `API 端点不存在 (404 Not Found)：${lastError || "请检查 Base URL 是否缺少 /v1 或路径拼写"}`
        : lastError || "无法连接到该端点，请检查 API 地址与网络环境";

    return NextResponse.json({
      ok: false,
      latencyMs,
      status: lastStatus || 500,
      error: friendlyError,
    });
  } catch (err: unknown) {
    const latencyMs = Math.max(1, Date.now() - startTime);
    return NextResponse.json(
      {
        ok: false,
        latencyMs,
        error: (err as Error)?.message || "解析请求失败",
      },
      { status: 400 }
    );
  }
}
