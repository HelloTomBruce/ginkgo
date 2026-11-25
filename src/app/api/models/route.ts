import { NextResponse } from "next/server";
import { LLM_PROVIDER_PRESETS } from "@/lib/llmProviders";

interface ModelsRequestBody {
  baseURL?: string;
  apiKey?: string;
  protocol?: "openai" | "anthropic";
  presetId?: string;
}

function findFallbackPreset(baseURL: string, presetId?: string) {
  if (presetId) {
    const matched = LLM_PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (matched) return matched;
  }
  const clean = baseURL.trim().replace(/\/+$/, "");
  return LLM_PROVIDER_PRESETS.find(
    (p) => p.baseURL.trim().replace(/\/+$/, "") === clean
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ModelsRequestBody;
    const { baseURL, apiKey, protocol = "openai", presetId } = body;

    if (!baseURL || typeof baseURL !== "string") {
      return NextResponse.json(
        { ok: false, error: "缺少或非法的 API 地址 (baseURL)" },
        { status: 400 }
      );
    }

    const cleanBaseURL = baseURL.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // 候选探测地址列表：优先根据规范拼接，404 时尝试变体
    const candidateUrls: string[] = [];

    if (protocol === "anthropic") {
      if (apiKey) {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      }
      if (cleanBaseURL.endsWith("/models")) {
        candidateUrls.push(cleanBaseURL);
      } else if (cleanBaseURL.endsWith("/v1")) {
        candidateUrls.push(`${cleanBaseURL}/models`);
      } else {
        candidateUrls.push(`${cleanBaseURL}/v1/models`);
        candidateUrls.push(`${cleanBaseURL}/models`);
      }
    } else {
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      if (cleanBaseURL.endsWith("/models")) {
        candidateUrls.push(cleanBaseURL);
      } else if (cleanBaseURL.endsWith("/v1")) {
        candidateUrls.push(`${cleanBaseURL}/models`);
        candidateUrls.push(`${cleanBaseURL.replace(/\/v1$/, "")}/models`);
      } else {
        candidateUrls.push(`${cleanBaseURL}/v1/models`);
        candidateUrls.push(`${cleanBaseURL}/models`);
      }
    }

    let lastError = "";
    let is404Or405 = false;

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

        if (response.ok) {
          const data = await response.json();
          let modelList: string[] = [];

          if (Array.isArray(data?.data)) {
            modelList = data.data
              .map((item: { id?: string }) => item?.id)
              .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
          } else if (Array.isArray(data?.models)) {
            modelList = data.models
              .map((item: { id?: string; name?: string }) => item?.id || item?.name)
              .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
          }

          if (modelList.length > 0) {
            const uniqueModels = Array.from(new Set(modelList)).sort();
            return NextResponse.json({
              ok: true,
              models: uniqueModels,
            });
          }
        } else {
          if (response.status === 404 || response.status === 405) {
            is404Or405 = true;
          }
          const errText = await response.text().catch(() => "");
          lastError = `HTTP ${response.status}`;
          try {
            const errJson = JSON.parse(errText);
            if (errJson?.error?.message) {
              lastError = errJson.error.message;
            }
          } catch {
            // ignore
          }
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const isAbort = (err as Error)?.name === "AbortError";
        lastError = isAbort ? "请求模型列表超时 (6s)" : ((err as Error)?.message || "网络请求异常");
      }
    }

    // 无法在线拉取时（如国内诸多厂商端点并未暴露 /models 接口返回 404/405），检查是否匹配已知官方预设
    const matchedPreset = findFallbackPreset(baseURL, presetId);
    if (is404Or405 && matchedPreset && matchedPreset.models.length > 0) {
      return NextResponse.json({
        ok: true,
        models: matchedPreset.models,
        fallback: true,
        notice: `该端点未提供在线 /models 查询，已自动匹配「${matchedPreset.name}」官方推荐模型列表`,
      });
    }

    // 无预设且接口 404：返回清晰易懂的指引
    const userFriendlyMsg = is404Or405
      ? "该端点未提供在线 /models 查询接口（404 Not Found），请使用下方「+ 添加模型」手动添加模型 ID"
      : lastError;

    return NextResponse.json({ ok: false, error: userFriendlyMsg }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || "解析请求失败" },
      { status: 400 }
    );
  }
}
