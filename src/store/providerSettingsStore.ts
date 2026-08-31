import { create } from "zustand";
import type { ProviderSettings, ProviderType } from "@/types/providers";

export const PROVIDER_SETTINGS_KEY = "node-banana-provider-settings";

export const defaultProviderSettings: ProviderSettings = {
  providers: {
    gemini: {
      id: "gemini",
      name: "Google Gemini",
      enabled: true,
      apiKey: null,
      apiKeyEnvVar: "GEMINI_API_KEY",
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      enabled: true,
      apiKey: null,
      apiKeyEnvVar: "OPENAI_API_KEY",
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      enabled: true,
      apiKey: null,
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    },
    replicate: {
      id: "replicate",
      name: "Replicate",
      enabled: false,
      apiKey: null,
      apiKeyEnvVar: "REPLICATE_API_KEY",
    },
    fal: {
      id: "fal",
      name: "fal.ai",
      enabled: false,
      apiKey: null,
      apiKeyEnvVar: "FAL_API_KEY",
    },
    kie: {
      id: "kie",
      name: "Kie.ai",
      enabled: false,
      apiKey: null,
      apiKeyEnvVar: "KIE_API_KEY",
    },
    wavespeed: {
      id: "wavespeed",
      name: "WaveSpeed",
      enabled: false,
      apiKey: null,
      apiKeyEnvVar: "WAVESPEED_API_KEY",
    },
  },
};

export function loadProviderSettings(): ProviderSettings {
  if (typeof window === "undefined") return defaultProviderSettings;

  const stored = window.localStorage.getItem(PROVIDER_SETTINGS_KEY);
  if (!stored) return defaultProviderSettings;

  try {
    const parsed = JSON.parse(stored) as Partial<ProviderSettings>;
    return {
      providers: {
        ...defaultProviderSettings.providers,
        ...parsed.providers,
      },
    };
  } catch {
    return defaultProviderSettings;
  }
}

function persistProviderSettings(settings: ProviderSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(settings));
}

interface ProviderSettingsStore {
  providerSettings: ProviderSettings;
  updateProviderSettings: (settings: ProviderSettings) => void;
  updateProviderApiKey: (providerId: ProviderType, apiKey: string | null) => void;
  toggleProvider: (providerId: ProviderType, enabled: boolean) => void;
}

export const useProviderSettingsStore = create<ProviderSettingsStore>()((set, get) => ({
  providerSettings: loadProviderSettings(),

  updateProviderSettings: (settings) => {
    set({ providerSettings: settings });
    persistProviderSettings(settings);
  },

  updateProviderApiKey: (providerId, apiKey) => {
    const current = get().providerSettings;
    const updated: ProviderSettings = {
      providers: {
        ...current.providers,
        [providerId]: {
          ...current.providers[providerId],
          apiKey,
        },
      },
    };
    set({ providerSettings: updated });
    persistProviderSettings(updated);
  },

  toggleProvider: (providerId, enabled) => {
    const current = get().providerSettings;
    const updated: ProviderSettings = {
      providers: {
        ...current.providers,
        [providerId]: {
          ...current.providers[providerId],
          enabled,
        },
      },
    };
    set({ providerSettings: updated });
    persistProviderSettings(updated);
  },
}));
