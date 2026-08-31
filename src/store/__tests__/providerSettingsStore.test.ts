import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultProviderSettings,
  loadProviderSettings,
  PROVIDER_SETTINGS_KEY,
  useProviderSettingsStore,
} from "../providerSettingsStore";

describe("providerSettingsStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useProviderSettingsStore.setState({
      providerSettings: defaultProviderSettings,
    });
  });

  it("loads defaults when persisted settings are absent", () => {
    expect(loadProviderSettings()).toEqual(defaultProviderSettings);
  });

  it("merges persisted settings with newly supported providers", () => {
    window.localStorage.setItem(
      PROVIDER_SETTINGS_KEY,
      JSON.stringify({
        providers: {
          anthropic: {
            id: "anthropic",
            name: "Anthropic",
            enabled: true,
            apiKey: "sk-ant-test",
          },
        },
      }),
    );

    const loaded = loadProviderSettings();
    expect(loaded.providers.anthropic.apiKey).toBe("sk-ant-test");
    expect(loaded.providers.gemini).toEqual(
      defaultProviderSettings.providers.gemini,
    );
  });

  it("persists API-key updates independently from the retired workflow store", () => {
    useProviderSettingsStore.getState().updateProviderApiKey(
      "anthropic",
      "sk-ant-test",
    );

    expect(
      useProviderSettingsStore.getState().providerSettings.providers.anthropic
        .apiKey,
    ).toBe("sk-ant-test");
    expect(
      JSON.parse(window.localStorage.getItem(PROVIDER_SETTINGS_KEY) ?? "{}")
        .providers.anthropic.apiKey,
    ).toBe("sk-ant-test");
  });
});
