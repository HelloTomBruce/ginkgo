"use client";

import { useState, useEffect, useCallback } from "react";

export interface HarnessEngineSettings {
  timeoutSeconds: number;
  maxRetries: number;
  backoffFactor: number;
  autoHealing: boolean;
  autoHealingAttempts: number;
}

export interface HarnessGovernanceSettings {
  dailyBudgetUsd: number;
  tokenLimit: number;
  telemetryEnabled: boolean;
  telemetrySampleRate: number;
  otelEndpoint: string;
}

export interface HarnessMcpRuntimeSettings {
  defaultTimeoutSeconds: number;
  maxPoolSize: number;
  maxReconnectRetries: number;
}

export interface HarnessSettingsState {
  engine: HarnessEngineSettings;
  governance: HarnessGovernanceSettings;
  mcpRuntime: HarnessMcpRuntimeSettings;
}

export const DEFAULT_HARNESS_SETTINGS: HarnessSettingsState = {
  engine: {
    timeoutSeconds: 30,
    maxRetries: 3,
    backoffFactor: 2.0,
    autoHealing: true,
    autoHealingAttempts: 2,
  },
  governance: {
    dailyBudgetUsd: 50.0,
    tokenLimit: 10_000_000,
    telemetryEnabled: false,
    telemetrySampleRate: 100,
    otelEndpoint: "",
  },
  mcpRuntime: {
    defaultTimeoutSeconds: 30,
    maxPoolSize: 5,
    maxReconnectRetries: 3,
  },
};

const STORAGE_KEY = "openui_harness_config";

function loadStoredSettings(): HarnessSettingsState {
  if (typeof window === "undefined") {
    return DEFAULT_HARNESS_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        engine: { ...DEFAULT_HARNESS_SETTINGS.engine, ...parsed.engine },
        governance: { ...DEFAULT_HARNESS_SETTINGS.governance, ...parsed.governance },
        mcpRuntime: { ...DEFAULT_HARNESS_SETTINGS.mcpRuntime, ...parsed.mcpRuntime },
      };
    }
  } catch (e) {
    console.warn("[useHarnessSettings] 读取本地配置失败，采用默认值:", e);
  }
  return DEFAULT_HARNESS_SETTINGS;
}

export function useHarnessSettings() {
  const [settings, setSettings] = useState<HarnessSettingsState>(loadStoredSettings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const saveSettings = useCallback((newSettings: HarnessSettingsState) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
    } catch (e) {
      console.error("[useHarnessSettings] 保存本地配置失败:", e);
    }
  }, []);

  const updateEngine = useCallback((partial: Partial<HarnessEngineSettings>) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        engine: { ...prev.engine, ...partial },
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  }, []);

  const updateGovernance = useCallback((partial: Partial<HarnessGovernanceSettings>) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        governance: { ...prev.governance, ...partial },
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  }, []);

  const updateMcpRuntime = useCallback((partial: Partial<HarnessMcpRuntimeSettings>) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        mcpRuntime: { ...prev.mcpRuntime, ...partial },
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_HARNESS_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const exportConfigJson = useCallback((): string => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  const importConfigJson = useCallback((jsonStr: string): { success: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonStr);
      const merged: HarnessSettingsState = {
        engine: { ...DEFAULT_HARNESS_SETTINGS.engine, ...parsed.engine },
        governance: { ...DEFAULT_HARNESS_SETTINGS.governance, ...parsed.governance },
        mcpRuntime: { ...DEFAULT_HARNESS_SETTINGS.mcpRuntime, ...parsed.mcpRuntime },
      };
      saveSettings(merged);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "无效的 JSON 配置文件",
      };
    }
  }, [saveSettings]);

  return {
    settings,
    loaded,
    updateEngine,
    updateGovernance,
    updateMcpRuntime,
    resetToDefaults,
    exportConfigJson,
    importConfigJson,
  };
}
