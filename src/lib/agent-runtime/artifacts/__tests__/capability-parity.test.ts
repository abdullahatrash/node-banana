import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AgentAuthorizationService,
  InMemoryAgentAuthorizationRepository,
} from "@/lib/agent-authorization";
import {
  CapabilityDispatcher,
  authorizationContractDigestFor,
  createCapabilityRegistry,
  createDiscoveryRegistrations,
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools";
import type {
  AgentCapabilityGrant,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentResourceConstraints,
} from "@/types";
import { AesGcmArtifactCursorCodec } from "../cursor";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactMediaInspector,
  InMemoryArtifactRepository,
} from "../memory";
import { ArtifactService } from "../service";
import {
  ARTIFACT_CAPABILITY_IDENTITIES,
  createArtifactRegistrations,
} from "../capabilities";

const NOW = new Date("2026-07-25T02:00:00.000Z");

function emptyResources(
  artifactIds: string[] = [],
): AgentResourceConstraints {
  return {
    channelIds: [],
    credentialProfileIds: [],
    workflowIds: [],
    automationIds: [],
    artifactIds,
  };
}

describe("Artifact capability CLI/MCP parity", () => {
  it("publishes all six contracts and fails closed after resource or GrantSet revocation", async () => {
    const repository = new InMemoryArtifactRepository();
    const store = new InMemoryArtifactContentStore();
    const inspector = new InMemoryArtifactMediaInspector();
    const service = new ArtifactService(
      repository,
      store,
      inspector,
      new AesGcmArtifactCursorCodec(() => ({
        active: { id: "parity", key: Buffer.alloc(32, 9) },
        all: [{ id: "parity", key: Buffer.alloc(32, 9) }],
      })),
      { now: () => NOW },
    );
    const text = await service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "parity-seed-text",
      text: "authorized text",
    });
    const seedUpload = await service.beginImageUpload({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "parity-seed-image",
      mediaType: "image/png",
      expectedSizeBytes: Buffer.byteLength("seed-image"),
    });
    const seedUploadRecord = repository.uploads.get(seedUpload.uploadId)!;
    store.seedStaged(
      seedUploadRecord.stagingKey,
      Buffer.from("seed-image"),
      "image/png",
    );
    const image = await service.completeImageUpload({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "parity-seed-complete",
      uploadId: seedUpload.uploadId,
    });
    const generatedText = "generated provider copy";
    const generatedBytes = Buffer.from(generatedText, "utf8");
    const generated = await service.commitGenerated({
      workspaceId: "workspace-1",
      creatorPrincipalId: "principal-1",
      effectKey: "effect-generated-parity-0001",
      outputName: "text",
      content: {
        kind: "text",
        text: generatedText,
        mediaType: "text/plain; charset=utf-8",
        digest: `sha256:${createHash("sha256").update(generatedBytes).digest("hex")}`,
        sizeBytes: generatedBytes.byteLength,
      },
      origin: {
        workflowId: "workflow-parity",
        workflowRevisionId: "revision-parity-1",
        workflowRevision: 1,
        definitionDigest: `sha256:${"1".repeat(64)}`,
        runId: "run-parity-1",
        runStartSnapshotDigest: `sha256:${"2".repeat(64)}`,
        stepAttemptId: "attempt-parity-1",
        stepId: "draft-copy",
        attempt: 1,
        provider: "gemini",
        operationIdentity: "gemini.generate_text@1",
        providerOperation:
          "generativelanguage.v1beta.models.generateContent",
        providerOperationRef: "gemini-parity-response-1",
        model: "gemini-2.5-flash",
        intentDigest: `sha256:${"3".repeat(64)}`,
        providerMetadata: {
          evidence: {
            providerRequestId: "gemini-parity-response-1",
            httpStatus: 200,
            providerCode: null,
            operatorTraceRef: null,
            effectDisposition: "accepted",
          },
          usage: [{
            dimension: "gemini.tokens.input@1",
            unit: "count",
            source: "reported",
            quantity: "4",
          }],
          retryAfterMs: null,
          pollAfterMs: null,
        },
      },
      lineageInputs: [],
    });
    const registrations = [
      ...createDiscoveryRegistrations(),
      ...createArtifactRegistrations(service),
    ];
    const registry = createCapabilityRegistry(registrations);
    const exact = (
      name: keyof typeof ARTIFACT_CAPABILITY_IDENTITIES,
      artifactIds: string[] = [],
    ): AgentCapabilityGrant => {
      const identity = ARTIFACT_CAPABILITY_IDENTITIES[name];
      const registration = registry.getRegistration(identity)!;
      return {
        capability: `${identity.name}@${identity.version}`,
        authorizationContractDigest: authorizationContractDigestFor(
          identity,
          registration.authorization,
        ),
        resources: emptyResources(artifactIds),
      };
    };
    const grants = [
      exact("import"),
      exact("uploadBegin"),
      exact("uploadComplete"),
      exact("get", [text.id, image.id, generated.id]),
      exact("list"),
      exact("downloadCreate", [image.id]),
    ];
    const authorizationRepository =
      new InMemoryAgentAuthorizationRepository();
    authorizationRepository.addAdministrator("workspace-1", "owner-1");
    const principal: AgentPrincipalRecord = {
      id: "principal-1",
      workspaceId: "workspace-1",
      sponsorUserId: "owner-1",
      name: "Artifact agent",
      requestedAccess: [],
      status: "active",
      suspendedAt: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const key: AgentKeyRecord = {
      id: "key-1",
      principalId: principal.id,
      name: "Artifact key",
      lookupPrefix: "lookup",
      secretHash: "unused",
      pepperVersion: 1,
      authorizationScopes: grants,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: NOW,
    };
    authorizationRepository.principals.set(principal.id, principal);
    authorizationRepository.keys.set(key.id, key);
    authorizationRepository.setResourceActive("workspace-1", {
      kind: "artifact",
      id: text.id,
    });
    authorizationRepository.setResourceActive("workspace-1", {
      kind: "artifact",
      id: image.id,
    });
    authorizationRepository.setResourceActive("workspace-1", {
      kind: "artifact",
      id: generated.id,
    });
    const authorization = new AgentAuthorizationService(
      authorizationRepository,
      { now: () => NOW },
    );
    await authorization.putWorkspacePolicy({
      workspaceId: "workspace-1",
      enabled: true,
      grants,
      actorUserId: "owner-1",
    });
    const authority = await authorization.createGrantSet({
      workspaceId: "workspace-1",
      principalId: principal.id,
      name: "Artifacts",
      grants,
      actorUserId: "owner-1",
    });
    const dispatcher = new CapabilityDispatcher(registry, authorization);
    const port = {
      dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
        dispatcher.dispatch(invocation, {
          securityContext: {
            kind: "agent",
            principalId: principal.id,
            workspaceId: principal.workspaceId,
            keyId: key.id,
          },
        }),
    };
    const transports = [
      {
        name: "CLI",
        invoke: (capability: string, input: unknown) =>
          dispatchCliCapability(capability, input, port),
      },
      {
        name: "MCP",
        invoke: (capability: string, input: unknown) =>
          dispatchMcpCapability(
            capability.replace("@1", ".v1"),
            input,
            port,
          ),
      },
    ];

    for (const [index, transport] of transports.entries()) {
      await expect(
        transport.invoke("artifacts.get@1", {
          artifactId: "invalid/artifact-id",
        }),
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "VALIDATION_FAILED",
      });
      await expect(
        transport.invoke("artifacts.import@1", {
          idempotencyKey: `invalid\u0000key-${index}`,
          text: "must not dispatch",
        }),
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "VALIDATION_FAILED",
      });

      const imported = await transport.invoke("artifacts.import@1", {
        idempotencyKey: `parity-import-${index}`,
        text: `transport ${transport.name}`,
      });
      expect(imported).toMatchObject({
        type: "capability_result",
        output: {
          kind: "text",
          creatorPrincipalId: principal.id,
          lineage: { sourceArtifactIds: [] },
        },
      });
      expect(JSON.stringify(imported)).not.toContain("storageKey");
      await expect(
        transport.invoke("artifacts.import@1", {
          idempotencyKey: `url-import-${index}`,
          sourceUrl: "https://untrusted.invalid/image.png",
        }),
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "VALIDATION_FAILED",
      });
      await expect(
        transport.invoke("artifact_uploads.begin@1", {
          idempotencyKey: `missing-size-${index}`,
          mediaType: "image/png",
        }),
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "VALIDATION_FAILED",
      });

      const upload = await transport.invoke("artifact_uploads.begin@1", {
        idempotencyKey: `parity-begin-${index}`,
        mediaType: "image/png",
        expectedSizeBytes: Buffer.byteLength(`transport-image-${index}`),
      });
      expect(upload).toMatchObject({
        type: "capability_result",
        output: {
          uploadUrl: expect.stringMatching(/^https:\/\/upload\.invalid/),
          requiredHeaders: {
            contentType: "image/png",
            contentLength: Buffer.byteLength(`transport-image-${index}`),
          },
        },
      });
      if (upload.type !== "capability_result") continue;
      const uploadId = (upload.output as { uploadId: string }).uploadId;
      const uploadRecord = repository.uploads.get(uploadId)!;
      store.seedStaged(
        uploadRecord.stagingKey,
        Buffer.from(`transport-image-${index}`),
        "image/png",
      );
      await expect(
        transport.invoke("artifact_uploads.complete@1", {
          idempotencyKey: `parity-complete-${index}`,
          uploadId,
        }),
      ).resolves.toMatchObject({
        type: "capability_result",
        output: { kind: "image", mediaType: "image/png" },
      });

      const get = await transport.invoke("artifacts.get@1", {
        artifactId: text.id,
      });
      expect(get).toMatchObject({
        type: "capability_result",
        output: {
          artifact: { id: text.id },
          textContent: "authorized text",
        },
      });
      expect(JSON.stringify(get)).not.toContain("storageKey");
      expect(JSON.stringify(get)).not.toContain("downloadUrl");

      await expect(
        transport.invoke("artifacts.get@1", {
          artifactId: generated.id,
        }),
      ).resolves.toMatchObject({
        type: "capability_result",
        output: {
          artifact: {
            id: generated.id,
            origin: {
              kind: "generated",
              providerOperation: {
                provider: "gemini",
                metadata: {
                  evidence: {
                    providerRequestId: "gemini-parity-response-1",
                  },
                },
              },
            },
            lineage: { inputs: [], sourceArtifactIds: [] },
          },
          textContent: generatedText,
        },
      });

      await expect(
        transport.invoke("artifacts.list@1", { limit: 100 }),
      ).resolves.toMatchObject({
        type: "capability_result",
        output: {
          artifacts: expect.arrayContaining([
            expect.objectContaining({ id: text.id }),
            expect.objectContaining({ id: image.id }),
            expect.objectContaining({ id: generated.id }),
          ]),
        },
      });

      await expect(
        transport.invoke("artifact_downloads.create@1", {
          artifactId: image.id,
        }),
      ).resolves.toMatchObject({
        type: "capability_result",
        output: {
          artifactId: image.id,
          downloadUrl: expect.stringMatching(/^https:\/\/download\.invalid/),
        },
      });

      await expect(
        transport.invoke("artifacts.get@1", {
          artifactId: "missing-artifact",
        }),
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
      });
    }
    const signedBeforeRevocation = store.downloadHandoffs.length;
    const pending = await dispatchCliCapability(
      "artifact_uploads.begin@1",
      {
        idempotencyKey: "revoke-before-complete",
        mediaType: "image/png",
        expectedSizeBytes: 1,
      },
      port,
    );
    expect(pending.type).toBe("capability_result");
    authorizationRepository.grantSets.set(authority.grantSet.id, {
      ...authority.grantSet,
      disabledAt: NOW,
      updatedAt: NOW,
    });
    for (const transport of transports) {
      for (const [capability, input] of [
        ["artifacts.get@1", { artifactId: text.id }],
        ["artifact_downloads.create@1", { artifactId: image.id }],
        [
          "artifact_uploads.complete@1",
          {
            idempotencyKey: `revoked-complete-${transport.name}`,
            uploadId:
              pending.type === "capability_result"
                ? (pending.output as { uploadId: string }).uploadId
                : "unavailable",
          },
        ],
        [
          "artifact_uploads.begin@1",
          {
            idempotencyKey: `revoked-begin-${transport.name}`,
            mediaType: "image/png",
            expectedSizeBytes: 1,
          },
        ],
      ] as const) {
        const denied = await transport.invoke(capability, input);
        expect(denied).toMatchObject({
          type: "capability_error",
          code: "CAPABILITY_NOT_AUTHORIZED",
        });
        expect(JSON.stringify(denied)).not.toContain(text.digest);
        expect(JSON.stringify(denied)).not.toContain("downloadUrl");
      }
    }
    expect(store.downloadHandoffs).toHaveLength(signedBeforeRevocation);
  });
});
