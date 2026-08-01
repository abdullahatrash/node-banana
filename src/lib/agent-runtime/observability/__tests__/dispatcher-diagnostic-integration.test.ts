import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CapabilityDispatcher,
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  createCapabilityRegistry,
  defineCapability,
} from "@/lib/agent-tools";
import { createObservabilityRegistrations } from "../capabilities";
import { InMemoryObservabilityRepository } from "../memory";
import { ObservabilityService } from "../service";
import type { SupportBundleApplication } from "../support-bundles";
import type { ObservabilityCursorCodec } from "../types";

const codec: ObservabilityCursorCodec = {
  encode: async () => "unused",
  decode: async () => null,
};

describe("CapabilityDispatcher durable authorization diagnostics", () => {
  it("resolves the published denial reference through diagnostic_traces.get@1", async () => {
    const repository = new InMemoryObservabilityRepository();
    const service = new ObservabilityService(repository, codec);
    const recordedAt = new Date(Date.now() - 1_000);
    const readAt = new Date(recordedAt.getTime() + 2_000);
    await service.setRetention({
      workspaceId: "workspace-safe",
      metricTtlSeconds: 3_600,
      traceTtlSeconds: 600,
      supportBundleTtlSeconds: 600,
      actorUserId: "owner-safe",
      idempotencyKey: "retention-safe",
      recordedAt,
    });
    const grant = await service.issueOperatorGrant({
      workspaceId: "workspace-safe",
      operatorId: "operator-safe",
      scopes: ["trace.read"],
      expiresAt: new Date(recordedAt.getTime() + 60_000),
      issuedByUserId: "owner-safe",
      actorRole: "owner",
      idempotencyKey: "grant-safe",
      recordedAt,
    });

    const deniedDispatcher = new CapabilityDispatcher(
      createCapabilityRegistry([
        defineCapability({
          identity: { name: "fixtures.authorization_denied", version: 1 },
          summary: "Authorization diagnostic fixture.",
          lifecycle: {
            status: "active",
            introducedAt: "2026-08-01T00:00:00.000Z",
            recommended: true,
          },
          input: z.object({}).strict(),
          outputSchema: { type: "object" },
          effect: QUERY_EFFECT,
          approval: { mode: "none" },
          idempotency: { mode: "retry-safe" },
          authorization: { resources: [] },
          errors: COMMON_DISCOVERY_ERRORS,
          handler: () => ({ ok: true }),
        }),
      ]),
      {
        authorize: async () => ({
          allowed: false,
          code: "CAPABILITY_NOT_AUTHORIZED",
          message: "Authorization: Bearer admission-secret",
          operatorTraceRef: `otr_${"c".repeat(32)}`,
        }),
      },
      (event) => service.recordTrace(event),
    );
    const denied = await deniedDispatcher.dispatch(
      {
        capability: "fixtures.authorization_denied@1",
        input: {},
      },
      {
        securityContext: {
          kind: "agent",
          workspaceId: "workspace-safe",
          principalId: "principal-safe",
          keyId: "key-safe",
        },
      },
    );
    expect(denied).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
      operatorTraceRef: expect.stringMatching(/^otr_[a-f0-9]{32}$/),
    });
    if (denied.type !== "capability_error" || !denied.operatorTraceRef) {
      throw new Error("A durable authorization trace was expected.");
    }
    expect(denied.operatorTraceRef).not.toBe(`otr_${"c".repeat(32)}`);

    const traceDispatcher = new CapabilityDispatcher(
      createCapabilityRegistry(
        createObservabilityRegistrations(
          service,
          {} as SupportBundleApplication,
          { now: () => readAt },
        ),
      ),
      { authorize: async () => ({ allowed: true }) },
    );
    const trace = await traceDispatcher.dispatch(
      {
        capability: "diagnostic_traces.get@1",
        input: {
          operatorTraceRef: denied.operatorTraceRef,
          operatorGrantId: grant.id,
        },
      },
      {
        securityContext: {
          kind: "human",
          workspaceId: "workspace-safe",
          userId: "operator-safe",
          role: "member",
        },
      },
    );

    expect(trace).toMatchObject({
      type: "capability_result",
      output: {
        operatorTraceRef: denied.operatorTraceRef,
        category: "authorization",
        code: "CAPABILITY_NOT_AUTHORIZED",
        stage: "admission",
        outcome: "denied",
      },
    });
    expect(JSON.stringify({ denied, trace })).not.toContain("admission-secret");
  });
});
