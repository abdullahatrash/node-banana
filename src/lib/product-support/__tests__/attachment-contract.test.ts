import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const attachments = readFileSync("src/lib/product-support/attachments.ts", "utf8");
const submission = readFileSync("src/app/api/product-support/submit/route.ts", "utf8");
const commands = readFileSync("src/lib/product-support/commands.ts", "utf8");
const exportRoute = readFileSync("src/app/api/product-support/[recordId]/export/route.ts", "utf8");

describe("support attachment HTTP contract", () => {
  it("pins reads and writes to the authorized workspace", () => {
    expect(submission).toContain('permission: "product:support:submit"');
    expect(submission).toContain("workspaceId: authz.workspaceId");
    expect(attachments).toContain("eq(assets.workspaceId, input.workspaceId)");
    expect(attachments).toContain("isNull(assets.deletedAt)");
    expect(exportRoute).toContain('action: "read"');
  });

  it("exports reference lineage without storage locations or duplicated bytes", () => {
    expect(commands).toContain("attachmentRefs");
    expect(commands).toContain("resolveSupportAttachmentReferencesWithExecutor(tx");
    expect(attachments).not.toContain("assets.storageKey");
    expect(exportRoute).toContain('"cache-control": "private, no-store"');
  });
});
