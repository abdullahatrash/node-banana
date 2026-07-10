import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearConfig,
  getConfigPath,
  loadConfig,
  saveConfig,
} from "../config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nb-cli-config-"));
  process.env.NB_CONFIG_DIR = dir;
});

afterEach(() => {
  delete process.env.NB_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("config storage", () => {
  it("resolves the config path inside the NB_CONFIG_DIR override", () => {
    expect(getConfigPath()).toBe(join(dir, "config.json"));
  });

  it("returns null when no config file exists yet", () => {
    expect(loadConfig()).toBeNull();
  });

  it("round-trips a saved token and url", () => {
    saveConfig({ token: "nb_secret", url: "https://api.example.com" });

    expect(loadConfig()).toEqual({
      token: "nb_secret",
      url: "https://api.example.com",
    });
  });

  it("writes the config file with 0600 permissions", () => {
    saveConfig({ token: "nb_secret", url: "https://api.example.com" });

    const mode = statSync(getConfigPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("creates missing parent directories when saving", () => {
    // The temp dir exists but the nested node-banana dir is created lazily.
    delete process.env.NB_CONFIG_DIR;
    const nested = join(dir, "deep", "nested");
    process.env.NB_CONFIG_DIR = nested;

    saveConfig({ token: "nb_secret", url: "https://api.example.com" });

    expect(existsSync(join(nested, "config.json"))).toBe(true);
  });

  it("overwrites an existing config on save", () => {
    saveConfig({ token: "nb_first", url: "https://a.example.com" });
    saveConfig({ token: "nb_second", url: "https://b.example.com" });

    expect(loadConfig()).toEqual({
      token: "nb_second",
      url: "https://b.example.com",
    });
  });

  it("clears a stored config", () => {
    saveConfig({ token: "nb_secret", url: "https://api.example.com" });
    clearConfig();

    expect(loadConfig()).toBeNull();
    expect(existsSync(getConfigPath())).toBe(false);
  });

  it("treats a corrupt config file as absent rather than throwing", () => {
    saveConfig({ token: "nb_secret", url: "https://api.example.com" });
    // Simulate corruption by writing garbage over the file.
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(getConfigPath(), "{ not json");

    expect(loadConfig()).toBeNull();
  });
});
