import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmArtifactCursorCodec } from "../cursor";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactMediaInspector,
  InMemoryArtifactRepository,
} from "../memory";
import {
  ArtifactService,
  type CommitGeneratedArtifactInput,
} from "../service";
import { SharpArtifactMediaInspector } from "../storage";

const firstNow = new Date("2026-07-25T02:00:00.000Z");
const laterNow = new Date("2026-07-25T02:01:00.000Z");

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixture(input: {
  inspector?: InMemoryArtifactMediaInspector | SharpArtifactMediaInspector;
  clock?: { now(): Date };
} = {}) {
  const repository = new InMemoryArtifactRepository();
  const store = new InMemoryArtifactContentStore();
  const inspector =
    input.inspector ?? new InMemoryArtifactMediaInspector();
  const cursor = new AesGcmArtifactCursorCodec(() => ({
    active: { id: "test-current", key: Buffer.alloc(32, 7) },
    all: [{ id: "test-current", key: Buffer.alloc(32, 7) }],
  }));
  const service = new ArtifactService(
    repository,
    store,
    inspector,
    cursor,
    input.clock ?? { now: () => firstNow },
  );
  return { repository, store, inspector, service };
}

function generatedOrigin(
  overrides: Partial<CommitGeneratedArtifactInput["origin"]> = {},
): CommitGeneratedArtifactInput["origin"] {
  return {
    workflowId: "workflow-1",
    workflowRevisionId: "revision-1",
    workflowRevision: 3,
    definitionDigest: `sha256:${"1".repeat(64)}`,
    runId: "run-1",
    runStartSnapshotDigest: `sha256:${"2".repeat(64)}`,
    stepAttemptId: "attempt-1",
    stepId: "draft-copy",
    attempt: 1,
    provider: "conformance",
    operationIdentity: "conformance.generate_linkedin_copy@1",
    providerOperation: "generate_linkedin_copy",
    providerOperationRef: "conformance:golden:draft-copy:v1",
    model: "golden-fixture-v1",
    intentDigest: `sha256:${"3".repeat(64)}`,
    ...overrides,
  };
}

function generatedTextInput(input: {
  effectKey?: string;
  outputName?: string;
  text?: string;
  origin?: Partial<CommitGeneratedArtifactInput["origin"]>;
  lineageInputs?: CommitGeneratedArtifactInput["lineageInputs"];
} = {}): CommitGeneratedArtifactInput {
  const text = input.text ?? "Frozen LinkedIn copy";
  const bytes = Buffer.from(text, "utf8");
  return {
    workspaceId: "workspace-1",
    creatorPrincipalId: "principal-1",
    effectKey: input.effectKey ?? "effect-copy-0001",
    outputName: input.outputName ?? "text",
    content: {
      kind: "text",
      text,
      mediaType: "text/plain; charset=utf-8",
      digest: digest(bytes),
      sizeBytes: bytes.byteLength,
    },
    origin: generatedOrigin(input.origin),
    lineageInputs: input.lineageInputs ?? [],
  };
}

describe("generated Artifact settlement", () => {
  it("persists discriminated provenance and ordered lineage without leaking internal content details", async () => {
    const value = fixture();
    const brief = await value.service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "brief-import-0001",
      text: "Approved launch brief",
    });
    const generated = await value.service.commitGenerated(
      generatedTextInput({
        lineageInputs: [
          {
            port: "brief",
            kind: "text",
            source: {
              kind: "workflow_input",
              inputName: "brief",
            },
            contentDigest: brief.digest,
            sourceArtifactId: brief.id,
          },
          {
            port: "tone",
            kind: "text",
            source: {
              kind: "workflow_input",
              inputName: "tone",
            },
            contentDigest: `sha256:${"4".repeat(64)}`,
            sourceArtifactId: null,
          },
        ],
      }),
    );

    expect(generated).toMatchObject({
      id: expect.stringMatching(/^artifact_[a-f0-9]{64}$/),
      workspaceId: "workspace-1",
      creatorPrincipalId: "principal-1",
      origin: {
        kind: "generated",
        generatedAt: firstNow.toISOString(),
        workflowRevision: {
          workflowId: "workflow-1",
          revisionId: "revision-1",
          revision: 3,
          definitionDigest: `sha256:${"1".repeat(64)}`,
        },
        run: {
          runId: "run-1",
          startSnapshotDigest: `sha256:${"2".repeat(64)}`,
        },
        stepAttempt: {
          stepAttemptId: "attempt-1",
          stepId: "draft-copy",
          attempt: 1,
        },
        providerOperation: {
          provider: "conformance",
          operationIdentity:
            "conformance.generate_linkedin_copy@1",
          operation: "generate_linkedin_copy",
          ref: "conformance:golden:draft-copy:v1",
          model: "golden-fixture-v1",
          intentDigest: `sha256:${"3".repeat(64)}`,
        },
        effectKey: "effect-copy-0001",
      },
      lineage: {
        inputs: [
          {
            port: "brief",
            source: {
              kind: "workflow_input",
              inputName: "brief",
            },
            artifactId: brief.id,
          },
          {
            port: "tone",
            source: {
              kind: "workflow_input",
              inputName: "tone",
            },
            artifactId: null,
          },
        ],
        sourceArtifactIds: [brief.id],
      },
    });
    const serialized = JSON.stringify(generated);
    for (const forbidden of [
      "storageKey",
      "inlineText",
      "textContent",
      "bytes",
      "downloadUrl",
      "uploadUrl",
      "authorization",
      "rawResponse",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("converges concurrent and later retries by exact Effect Key and output port", async () => {
    let current = firstNow;
    const value = fixture({ clock: { now: () => current } });
    const request = generatedTextInput();
    const [left, right] = await Promise.all([
      value.service.commitGenerated(request),
      value.service.commitGenerated(structuredClone(request)),
    ]);

    expect(right.id).toBe(left.id);
    expect(value.repository.artifacts.size).toBe(1);
    expect(value.repository.generatedOrigins.size).toBe(1);
    expect(value.repository.generatedOutputs.size).toBe(1);
    expect(value.repository.contents.size).toBe(1);

    current = laterNow;
    const laterReplay =
      await value.service.commitGenerated(structuredClone(request));
    expect(laterReplay.id).toBe(left.id);
    expect(laterReplay.createdAt).toBe(firstNow.toISOString());
    expect(laterReplay.origin).toMatchObject({
      kind: "generated",
      generatedAt: firstNow.toISOString(),
    });

    const distinctOutput = await value.service.commitGenerated(
      generatedTextInput({ outputName: "alternate_text" }),
    );
    expect(distinctOutput.id).not.toBe(left.id);
    expect(distinctOutput.digest).toBe(left.digest);
    expect(value.repository.artifacts.size).toBe(2);
    expect(value.repository.contents.size).toBe(1);
  });

  it("rejects semantic reuse of an Effect Key and output port", async () => {
    const value = fixture();
    await value.service.commitGenerated(generatedTextInput());

    await expect(
      value.service.commitGenerated(
        generatedTextInput({ text: "Different provider output" }),
      ),
    ).rejects.toMatchObject({
      code: "ARTIFACT_IDEMPOTENCY_CONFLICT",
    });
    await expect(
      value.service.commitGenerated(
        generatedTextInput({
          origin: { stepAttemptId: "attempt-2", attempt: 2 },
        }),
      ),
    ).rejects.toMatchObject({
      code: "ARTIFACT_IDEMPOTENCY_CONFLICT",
    });
    expect(value.repository.artifacts.size).toBe(1);
    expect(value.repository.generatedOrigins.size).toBe(1);
  });

  it("validates generated image bytes, digest, media type, and dimensions before storage", async () => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8i8AAAAASUVORK5CYII=",
      "base64",
    );
    const value = fixture({
      inspector: new SharpArtifactMediaInspector(),
    });
    const request: CommitGeneratedArtifactInput = {
      workspaceId: "workspace-1",
      creatorPrincipalId: "principal-1",
      effectKey: "effect-image-0001",
      outputName: "image",
      content: {
        kind: "image",
        bytes,
        mediaType: "image/png",
        digest: digest(bytes),
        sizeBytes: bytes.byteLength,
        width: 1,
        height: 1,
      },
      origin: generatedOrigin({
        stepAttemptId: "attempt-image-1",
        stepId: "generate-hero",
        operationIdentity:
          "conformance.generate_hero_image@1",
        providerOperation: "generate_hero_image",
      }),
      lineageInputs: [],
    };
    const artifact = await value.service.commitGenerated(request);
    expect(artifact).toMatchObject({
      kind: "image",
      mediaType: "image/png",
      width: 1,
      height: 1,
      digest: digest(bytes),
    });
    expect(value.store.generatedWrites).toHaveLength(1);
    const replay =
      await value.service.commitGenerated(structuredClone(request));
    expect(replay.id).toBe(artifact.id);
    expect(value.store.generatedWrites).toHaveLength(2);
    expect(value.store.content.size).toBe(1);
    expect(value.repository.artifacts.size).toBe(1);

    for (const invalidContent of [
      {
        ...request.content,
        bytes: Buffer.from("not an image"),
        digest: digest(Buffer.from("not an image")),
        sizeBytes: Buffer.byteLength("not an image"),
      },
      { ...request.content, width: 2 },
      { ...request.content, mediaType: "image/jpeg" },
      { ...request.content, digest: `sha256:${"0".repeat(64)}` },
    ]) {
      const isolated = fixture({
        inspector: new SharpArtifactMediaInspector(),
      });
      await expect(
        isolated.service.commitGenerated({
          ...request,
          content: invalidContent,
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_CONTENT_MISMATCH",
      });
      expect(isolated.store.generatedWrites).toHaveLength(0);
      expect(isolated.repository.artifacts.size).toBe(0);
    }
  });

  it("validates exact source Artifact lineage and converges after a metadata commit failure", async () => {
    const value = fixture();
    const source = await value.service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "source-import-0001",
      text: "source",
    });
    const request = generatedTextInput({
      lineageInputs: [
        {
          port: "brief",
          kind: "text",
          source: { kind: "workflow_input", inputName: "brief" },
          contentDigest: source.digest,
          sourceArtifactId: source.id,
        },
      ],
    });
    value.repository.failNextCommit = true;
    await expect(
      value.service.commitGenerated(request),
    ).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(value.repository.artifacts.size).toBe(1);
    expect(value.repository.generatedOrigins.size).toBe(0);

    const settled = await value.service.commitGenerated(request);
    expect(settled.origin.kind).toBe("generated");
    expect(value.repository.artifacts.size).toBe(2);
    expect(value.repository.generatedOrigins.size).toBe(1);

    await expect(
      value.service.commitGenerated(
        generatedTextInput({
          effectKey: "effect-copy-0002",
          lineageInputs: [
            {
              port: "brief",
              kind: "image",
              source: {
                kind: "workflow_input",
                inputName: "brief",
              },
              contentDigest: source.digest,
              sourceArtifactId: source.id,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(value.repository.generatedOrigins.size).toBe(1);
  });
});
