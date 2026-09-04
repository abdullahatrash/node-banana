import { describe, expect, it } from "vitest";
import { classifyContentLanguage } from "../studio-generation-client";
import { readFileSync } from "node:fs";

describe("Simple Studio content-language classification", () => {
  it("distinguishes Arabic, English, and materially mixed prompts", () => {
    expect(classifyContentLanguage("إعلان لمنتج جديد")).toBe("ar");
    expect(classifyContentLanguage("A new product campaign")).toBe("en");
    expect(classifyContentLanguage("Launch العرض الجديد today")).toBe("mixed");
  });
  it("does not call a prompt mixed for a short borrowed token", () => {
    expect(classifyContentLanguage("حملة عربية جديدة AI")).toBe("ar");
    expect(classifyContentLanguage("New campaign ع")).toBe("en");
  });
  it("routes Content through the canonical WorkflowRun endpoint rather than generic execution", () => {
    const source = readFileSync("src/lib/model-routing/studio-generation-client.ts", "utf8");
    const server = readFileSync("src/lib/model-routing/execute-admitted-generation.ts", "utf8");
    expect(source).toContain('input.contentExecution ? "/api/product-content/workflow-runs"');
    expect(server).toContain('if (!input.contentWorkflowRunId) return rejected(409, "CONTENT_WORKFLOW_RUN_REQUIRED")');
  });
});
