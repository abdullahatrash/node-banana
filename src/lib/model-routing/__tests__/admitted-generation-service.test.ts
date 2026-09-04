import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admitted generation application boundary", () => {
  it("keeps the route as an authenticated DTO boundary and centralizes orchestration", () => {
    const route = readFileSync("src/app/api/studio/generations/route.ts", "utf8");
    const http = readFileSync("src/lib/model-routing/admitted-generation-http.ts", "utf8");
    const service = readFileSync("src/lib/model-routing/admitted-generation-service.ts", "utf8");
    expect(route).toContain("createAdmittedGenerationPost");
    expect(http).toContain("admitStudioGeneration");
    expect(route).not.toContain("productionGenerationExecution");
    for (const stage of ["createImmutableRightsEvidence", "createIntent", "ensureAdmittedGenerationOperation"]) expect(service).toContain(stage);
    expect(service).not.toContain("productionGenerationExecution");
  });
});
