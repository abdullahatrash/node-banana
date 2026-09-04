import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("social publish workflow security contract", () => {
  it("claims the provider effect before resolving stable owned media and never publishes current raw URLs", async () => {
    const source = await readFile(join(process.cwd(), "workflows/social-publish.ts"), "utf8");
    const publishStep = source.slice(source.indexOf("async function publishStep("), source.indexOf("async function finalizeStep("));
    const claimIndex = publishStep.indexOf("claimSocialPostProviderEffect(");
    const resolutionIndex = publishStep.indexOf("resolveSocialPostMediaForDelivery(");
    const providerIndex = publishStep.indexOf("provider.post(");

    expect(claimIndex).toBeGreaterThan(0);
    expect(resolutionIndex).toBeGreaterThan(claimIndex);
    expect(providerIndex).toBeGreaterThan(resolutionIndex);
    expect(publishStep).not.toContain("media: current.mediaUrls");
    expect(publishStep).not.toContain("media: currentPost.mediaUrls");
  });
});
