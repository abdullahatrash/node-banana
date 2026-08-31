import { describe, expect, it } from "vitest";
import {
  executeProviderEffect,
  observeProviderEffect,
  parseProviderOutcome,
  validateProviderAdapterContract,
} from "@/lib/agent-runtime/runs/provider-adapter";
import {
  DETERMINISTIC_LINKEDIN_PLATFORM_CONTRACT,
  DeterministicLinkedInPlatformAdapter,
  DeterministicLinkedInPlatformTransport,
  type DeterministicLinkedInIntent,
} from "./deterministic-linkedin";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;

function intent(publishAt: string): DeterministicLinkedInIntent {
  return {
    schema: "publishing-platform-intent/v1",
    deliveryId: "delivery_1",
    planRevisionId: "revision_1",
    planRevisionDigest: DIGEST_A,
    targetId: "target_1",
    channel: {
      id: "channel_1",
      platform: "linkedin",
      authorKind: "person",
      snapshotDigest: DIGEST_B,
    },
    content: {
      artifactId: "artifact_text_1",
      digest: DIGEST_C,
      mediaType: "text/plain; charset=utf-8",
      text: "A deterministic future publication.",
    },
    media: [],
    settings: { type: "person" },
    publishAt,
  };
}

function request(publishAt: string) {
  return {
    effectKey: "publishing-effect:v1:workspace_1:delivery_1",
    intentDigest: DIGEST_A,
    intent: intent(publishAt),
    credentials: {
      primary: {
        profileId: "credential_linkedin_1",
        version: 1,
        secret: "secret-canary-never-retain",
      },
    },
  };
}

describe("deterministic LinkedIn Platform Adapter", () => {
  it("validates with the truthful Publishing Delivery launch guard", () => {
    expect(DETERMINISTIC_LINKEDIN_PLATFORM_CONTRACT.launchSafety).toEqual({
      mode: "native_effect_key",
      guard: "publishing-delivery/v1",
      replay: "provider_deduplicated",
    });
    expect(() =>
      validateProviderAdapterContract(
        DETERMINISTIC_LINKEDIN_PLATFORM_CONTRACT,
      ),
    ).not.toThrow();
  });

  it("accepts a future effect without claiming completion, then observes success", async () => {
    let current = new Date("2026-08-09T12:00:00.000Z");
    const transport = new DeterministicLinkedInPlatformTransport(
      () => current,
      1_000,
    );
    const adapter = new DeterministicLinkedInPlatformAdapter(transport);
    const effectRequest = request("2026-08-09T12:05:00.000Z");

    const accepted = await executeProviderEffect(adapter, effectRequest);
    expect(accepted).toMatchObject({
      kind: "outcome_unknown",
      failureCode: "PLATFORM_EFFECT_PENDING",
      providerOperationRef: expect.stringMatching(/^linkedin:effect:/),
      evidence: { effectDisposition: "accepted" },
    });
    expect(transport.effects).toHaveLength(1);

    current = new Date("2026-08-09T12:05:01.000Z");
    if (accepted.kind !== "outcome_unknown" || !accepted.providerOperationRef) {
      throw new TypeError("Expected an observable accepted effect.");
    }
    const completed = await observeProviderEffect(adapter, {
      ...effectRequest,
      providerOperationRef: accepted.providerOperationRef,
    });
    expect(completed).toMatchObject({
      kind: "succeeded",
      providerOperationRef: accepted.providerOperationRef,
      outputs: {
        publication: {
          providerPostRef: expect.stringMatching(/^urn:li:share:/),
          publishedAt: "2026-08-09T12:05:01.000Z",
        },
      },
    });
    expect(transport.launchCalls).toHaveLength(1);
    expect(transport.observationCalls).toHaveLength(1);
    expect(transport.effects).toHaveLength(1);
  });

  it("reuses one stable Effect Key and rejects changed intent without a second effect", async () => {
    const current = new Date("2026-08-09T12:00:00.000Z");
    const transport = new DeterministicLinkedInPlatformTransport(() => current);
    const adapter = new DeterministicLinkedInPlatformAdapter(transport);
    const firstRequest = request("2026-08-09T12:05:00.000Z");

    await executeProviderEffect(adapter, firstRequest);
    await executeProviderEffect(adapter, firstRequest);
    const conflict = await executeProviderEffect(adapter, {
      ...firstRequest,
      intentDigest: DIGEST_B,
    });

    expect(conflict).toMatchObject({
      kind: "failed_known",
      failureCode: "PROVIDER_EFFECT_KEY_CONFLICT",
      retryHint: { retryable: false },
      evidence: { effectDisposition: "not_created" },
    });
    expect(transport.effects).toHaveLength(1);
    expect(
      transport.launchCalls.map((call) => call.effectKey),
    ).toEqual([
      firstRequest.effectKey,
      firstRequest.effectKey,
      firstRequest.effectKey,
    ]);
  });

  it("cannot escape Delivery state, retries, events, or secrets", async () => {
    const current = new Date("2026-08-09T12:00:00.000Z");
    const transport = new DeterministicLinkedInPlatformTransport(() => current);
    const adapter = new DeterministicLinkedInPlatformAdapter(transport);
    const effectRequest = request("2026-08-09T12:05:00.000Z");
    const outcome = await adapter.execute(effectRequest);

    for (const forbidden of [
      { delivery: { state: "succeeded" } },
      { retryAt: "2026-08-09T12:01:00.000Z" },
      { events: [{ type: "publication.succeeded" }] },
    ]) {
      expect(() =>
        parseProviderOutcome(adapter.contract, { ...outcome, ...forbidden }),
      ).toThrow("Provider Adapter violated its normalized contract.");
    }

    const leaking = {
      ...adapter,
      contract: adapter.contract,
      execute: async () => ({
        kind: "succeeded" as const,
        providerOperationRef: "linkedin:effect:unsafe",
        outputs: {
          publication: {
            providerPostRef: effectRequest.credentials.primary.secret,
            publishedAt: current.toISOString(),
          },
        },
        evidence: {
          providerRequestId: null,
          httpStatus: 200,
          providerCode: null,
          operatorTraceRef: null,
          effectDisposition: "accepted" as const,
        },
        usage: [],
      }),
    };
    await expect(executeProviderEffect(leaking, effectRequest)).resolves.toMatchObject({
      kind: "outcome_unknown",
      failureCode: "PROVIDER_ADAPTER_EXCEPTION",
    });
  });
});
