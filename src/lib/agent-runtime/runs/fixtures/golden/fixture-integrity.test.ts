import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryWorkflowCredentialSlotAdmission } from "../../../workflows/memory";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../../workflows/operation-registry";
import { WorkflowRevisionValidator } from "../../../workflows/validation";
import frozenWorkflow from "../../../workflows/__fixtures__/linkedin-golden-workflow-v1.json";
import {
  GOLDEN_BRIEF,
  GOLDEN_EXPECTED_OUTPUT,
  GOLDEN_IMAGE_FIXTURES,
  GOLDEN_LINKEDIN_COPY,
  GOLDEN_OPERATION_CONTRACTS,
  GOLDEN_OPERATION_REGISTRY_DIGEST,
  GOLDEN_PROVIDER_INTENTS,
  GOLDEN_PROVIDER_RESULTS,
  GOLDEN_TEXT_BYTES,
  GOLDEN_WORKFLOW_DRAFT,
  GOLDEN_WORKFLOW_DEFINITION_DIGEST,
  GOLDEN_WORKFLOW_FIXTURE_BYTE_DIGEST,
  GOLDEN_WORKFLOW_FIXTURE_PATH,
  GOLDEN_WORKFLOW_FIXTURE_SIZE_BYTES,
} from "./index";

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inspectPng(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe("golden LinkedIn Workflow execution fixture", () => {
  it("wraps the unchanged #155 Workflow fixture bytes and object", () => {
    const bytes = readFileSync(
      resolve(process.cwd(), GOLDEN_WORKFLOW_FIXTURE_PATH),
    );
    expect({
      sizeBytes: bytes.byteLength,
      digest: digest(bytes),
    }).toEqual({
      sizeBytes: GOLDEN_WORKFLOW_FIXTURE_SIZE_BYTES,
      digest: GOLDEN_WORKFLOW_FIXTURE_BYTE_DIGEST,
    });
    expect(GOLDEN_WORKFLOW_DRAFT).toEqual(frozenWorkflow);
    expect(Object.isFrozen(GOLDEN_WORKFLOW_DRAFT)).toBe(true);
  });

  it("freezes the exact UTF-8 brief and provider text result", () => {
    const brief = Buffer.from(GOLDEN_BRIEF, "utf8");
    const linkedInCopy = Buffer.from(GOLDEN_LINKEDIN_COPY, "utf8");

    expect({
      sizeBytes: brief.byteLength,
      digest: digest(brief),
    }).toEqual({
      sizeBytes: GOLDEN_TEXT_BYTES.brief.sizeBytes,
      digest: GOLDEN_TEXT_BYTES.brief.digest,
    });
    expect({
      sizeBytes: linkedInCopy.byteLength,
      digest: digest(linkedInCopy),
    }).toEqual({
      sizeBytes: GOLDEN_TEXT_BYTES.linkedInCopy.sizeBytes,
      digest: GOLDEN_TEXT_BYTES.linkedInCopy.digest,
    });
  });

  it("freezes literal bytes, digests, and dimensions of both PNG fixtures", () => {
    for (const image of Object.values(GOLDEN_IMAGE_FIXTURES)) {
      const bytes = readFileSync(resolve(process.cwd(), image.path));
      expect({
        sizeBytes: bytes.byteLength,
        digest: digest(bytes),
        ...inspectPng(bytes),
      }).toEqual({
        sizeBytes: image.sizeBytes,
        digest: image.digest,
        width: image.width,
        height: image.height,
      });
    }
  });

  it("uses exact frozen Gemini contracts with conformance adapters", () => {
    expect(GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest).toBe(
      GOLDEN_OPERATION_REGISTRY_DIGEST,
    );
    const expected = [
      {
        fixture: GOLDEN_OPERATION_CONTRACTS.draftCopy,
        step: GOLDEN_WORKFLOW_DRAFT.steps[0],
      },
      {
        fixture: GOLDEN_OPERATION_CONTRACTS.generateHero,
        step: GOLDEN_WORKFLOW_DRAFT.steps[1],
      },
    ];
    for (const { fixture, step } of expected) {
      const published = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
        fixture.identity,
      );
      expect(published).toMatchObject({
        identity: fixture.identity,
        contractDigest: fixture.contractDigest,
        lifecycle: "active",
      });
      expect(step.operation).toBe(fixture.identity);
      expect(
        GOLDEN_WORKFLOW_OPERATION_REGISTRY.validateConfig(
          fixture.identity,
          step.config,
        ),
      ).toMatchObject({ success: true });
    }
  });

  it("freezes the normalized two-step Workflow behavior digest", async () => {
    const slots = new InMemoryWorkflowCredentialSlotAdmission();
    slots.allow({
      workspaceId: "workspace_golden",
      slotId: "slot_gemini_golden",
      profileId: "profile_gemini_golden",
      provider: "gemini",
    });
    const result = await new WorkflowRevisionValidator(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
      slots,
    ).validate({
      candidate: structuredClone(GOLDEN_WORKFLOW_DRAFT),
      workspaceId: "workspace_golden",
      principalId: "principal_golden",
      effectiveResources: {
        channelIds: [],
        credentialProfileIds: ["profile_gemini_golden"],
        workflowIds: [],
        automationIds: [],
        artifactIds: [],
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.digest).toBe(GOLDEN_WORKFLOW_DEFINITION_DIGEST);
    expect(result.normalizedDefinition?.steps.map(({ id }) => id)).toEqual([
      "draft_copy",
      "generate_hero",
    ]);
  });

  it("keeps provider intents, results, and expected outputs connected", () => {
    expect(GOLDEN_PROVIDER_INTENTS.draftCopy.prompt).toBe(GOLDEN_BRIEF);
    expect(GOLDEN_PROVIDER_INTENTS.draftCopy.provider).toBe("conformance");
    expect(GOLDEN_PROVIDER_INTENTS.generateHero.provider).toBe(
      "conformance",
    );
    expect(GOLDEN_PROVIDER_RESULTS.draftCopy.output.text).toBe(
      GOLDEN_LINKEDIN_COPY,
    );
    expect(GOLDEN_PROVIDER_INTENTS.generateHero).toMatchObject({
      prompt: GOLDEN_LINKEDIN_COPY,
      referenceImage: {
        digest: GOLDEN_IMAGE_FIXTURES.reference.digest,
      },
    });
    expect(GOLDEN_PROVIDER_RESULTS.generateHero.output).toMatchObject(
      GOLDEN_IMAGE_FIXTURES.heroResult,
    );
    expect(GOLDEN_EXPECTED_OUTPUT.outputs).toEqual({
      post_copy: GOLDEN_PROVIDER_RESULTS.draftCopy.output,
      hero_image: GOLDEN_PROVIDER_RESULTS.generateHero.output,
    });
  });
});
