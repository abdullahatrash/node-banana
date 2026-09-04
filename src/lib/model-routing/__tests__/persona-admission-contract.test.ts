import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Creator Persona generation admission contract", () => {
  it("binds the exact Persona before operation admission and revalidates before provider execution", () => {
    const admission = readFileSync("src/lib/model-routing/admitted-generation-service.ts", "utf8");
    const execution = readFileSync("src/lib/model-routing/execute-admitted-generation.ts", "utf8");
    expect(admission.indexOf("prepareUsage")).toBeLessThan(admission.indexOf("createIntent"));
    expect(admission.indexOf("bindUsage")).toBeLessThan(admission.indexOf("const operation = await ensureAdmittedGenerationOperation"));
    expect(admission).toContain("PERSONA_MODEL_MISMATCH");
    expect(execution.indexOf("resolveUsage")).toBeLessThan(execution.indexOf("productionGenerationExecution"));
    expect(execution).toContain("PERSONA_BINDING_CHANGED");
  });
});
