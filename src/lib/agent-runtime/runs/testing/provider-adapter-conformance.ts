import { describe, expect, it } from "vitest";
import {
  executeProviderEffect,
  observeProviderEffect,
  parseProviderOutcome,
  type ProviderAdapter,
  type ProviderEffectRequest,
  type ProviderOutcome,
} from "../provider-adapter";
import {
  DeterministicProviderFaultKit,
  providerResponse,
  type ProviderFaultStep,
} from "./provider-adapter-fault-kit";

export interface ProviderAdapterConformanceSubject<I, O> {
  name: string;
  createAdapter(transport: DeterministicProviderFaultKit): ProviderAdapter<I, O>;
  request: ProviderEffectRequest<I>;
  providerOperationRef: string;
  fixtures: {
    success: unknown;
    knownTerminalFailure: unknown;
    knownRetryableFailure: unknown;
    pending: unknown;
    malformed: unknown;
    successWithUsage: unknown;
    secretBearingMalformed(secret: string): unknown;
    successWithSecretOutput(secret: string): unknown;
  };
  assertSuccess(outcome: Extract<ProviderOutcome<O>, { kind: "succeeded" }>): void;
}

function responseStep(
  body: unknown,
  providerOperationRef: string | null,
  effectDisposition: ProviderFaultStep["effectDisposition"] = "accepted",
): ProviderFaultStep {
  return {
    kind: "response",
    effectDisposition,
    providerOperationRef,
    response: providerResponse(body),
  };
}

export function describeProviderAdapterConformance<I, O>(
  subject: ProviderAdapterConformanceSubject<I, O>,
): void {
  describe(`${subject.name} Provider Adapter conformance`, () => {
    it("propagates one stable Effect Key and creates at most one provider effect", async () => {
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch(
        responseStep(subject.fixtures.success, subject.providerOperationRef),
        responseStep(subject.fixtures.success, subject.providerOperationRef),
      );
      const first = await executeProviderEffect(
        subject.createAdapter(faults),
        subject.request,
      );
      const replay = await executeProviderEffect(
        subject.createAdapter(faults),
        subject.request,
      );
      expect(first.kind).toBe("succeeded");
      expect(replay).toEqual(first);
      expect(faults.launchCalls).toHaveLength(2);
      expect(
        faults.launchCalls.map(({ effectKey, intentDigest }) => ({
          effectKey,
          intentDigest,
        })),
      ).toEqual([
        {
          effectKey: subject.request.effectKey,
          intentDigest: subject.request.intentDigest,
        },
        {
          effectKey: subject.request.effectKey,
          intentDigest: subject.request.intentDigest,
        },
      ]);
      expect(faults.createdEffectCount).toBe(1);
    });

    it("rejects the same Effect Key with a different intent before another effect", async () => {
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch(
        responseStep(subject.fixtures.success, subject.providerOperationRef),
      );
      await executeProviderEffect(subject.createAdapter(faults), subject.request);
      const conflict = await executeProviderEffect(
        subject.createAdapter(faults),
        {
          ...subject.request,
          intentDigest:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      );
      expect(conflict).toMatchObject({
        kind: "failed_known",
        failureCode: "PROVIDER_EFFECT_KEY_CONFLICT",
        retryHint: { retryable: false, retryAfterMs: null },
        evidence: { effectDisposition: "not_created" },
      });
      expect(faults.createdEffectCount).toBe(1);
    });

    it("returns only normalized success, known failure, or unknown outcome", async () => {
      const cases: Array<{
        fixture: unknown;
        disposition: ProviderFaultStep["effectDisposition"];
        expected: ProviderOutcome<O>["kind"];
      }> = [
        {
          fixture: subject.fixtures.success,
          disposition: "accepted",
          expected: "succeeded",
        },
        {
          fixture: subject.fixtures.knownTerminalFailure,
          disposition: "terminal_failed",
          expected: "failed_known",
        },
        {
          fixture: subject.fixtures.knownRetryableFailure,
          disposition: "not_created",
          expected: "failed_known",
        },
        {
          fixture: subject.fixtures.malformed,
          disposition: "accepted",
          expected: "outcome_unknown",
        },
      ];
      for (const item of cases) {
        const faults = new DeterministicProviderFaultKit();
        faults.enqueueLaunch(
          responseStep(
            item.fixture,
            item.disposition === "not_created"
              ? null
              : subject.providerOperationRef,
            item.disposition,
          ),
        );
        const outcome = await executeProviderEffect(
          subject.createAdapter(faults),
          subject.request,
        );
        expect(outcome.kind).toBe(item.expected);
        expect([
          "succeeded",
          "failed_known",
          "outcome_unknown",
        ]).toContain(outcome.kind);
      }
    });

    it("classifies transport timeout and disconnect after contact as outcome_unknown", async () => {
      for (const kind of ["timeout", "disconnect"] as const) {
        const faults = new DeterministicProviderFaultKit();
        faults.enqueueLaunch({
          kind,
          effectDisposition: "accepted",
          providerOperationRef: subject.providerOperationRef,
        });
        const outcome = await executeProviderEffect(
          subject.createAdapter(faults),
          subject.request,
        );
        expect(outcome).toMatchObject({
          kind: "outcome_unknown",
          providerOperationRef: subject.providerOperationRef,
          evidence: { effectDisposition: "accepted" },
        });
        expect(faults.createdEffectCount).toBe(1);
      }
    });

    it("allows a known retry hint only with proof that no effect was created", async () => {
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch({
        kind: "timeout",
        effectDisposition: "not_created",
        providerOperationRef: null,
        retryAfterMs: 250,
      });
      const outcome = await executeProviderEffect(
        subject.createAdapter(faults),
        subject.request,
      );
      expect(outcome).toMatchObject({
        kind: "failed_known",
        retryHint: { retryable: true, retryAfterMs: 250 },
        evidence: { effectDisposition: "not_created" },
      });
      expect(faults.createdEffectCount).toBe(0);
    });

    it("polls the original effect without creating another effect", async () => {
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch(
        responseStep(subject.fixtures.pending, subject.providerOperationRef),
      );
      const pending = await executeProviderEffect(
        subject.createAdapter(faults),
        subject.request,
      );
      expect(pending).toMatchObject({
        kind: "outcome_unknown",
        providerOperationRef: subject.providerOperationRef,
      });
      faults.enqueueObservation(
        responseStep(subject.fixtures.success, subject.providerOperationRef),
      );
      const completed = await observeProviderEffect(
        subject.createAdapter(faults),
        {
          ...subject.request,
          providerOperationRef: subject.providerOperationRef,
        },
      );
      expect(completed.kind).toBe("succeeded");
      if (completed.kind === "succeeded") subject.assertSuccess(completed);
      expect(faults.launchCalls).toHaveLength(1);
      expect(faults.observationCalls).toHaveLength(1);
      expect(faults.observationCalls[0]?.providerOperationRef).toBe(
        subject.providerOperationRef,
      );
      expect(faults.createdEffectCount).toBe(1);
    });

    it("keeps malformed or disconnected polling unknown without resubmission", async () => {
      for (const observation of [
        responseStep(subject.fixtures.malformed, subject.providerOperationRef),
        {
          kind: "disconnect" as const,
          effectDisposition: "accepted" as const,
          providerOperationRef: subject.providerOperationRef,
        },
      ]) {
        const faults = new DeterministicProviderFaultKit();
        faults.enqueueLaunch(
          responseStep(subject.fixtures.pending, subject.providerOperationRef),
        );
        await executeProviderEffect(subject.createAdapter(faults), subject.request);
        faults.enqueueObservation(observation);
        const result = await observeProviderEffect(
          subject.createAdapter(faults),
          {
            ...subject.request,
            providerOperationRef: subject.providerOperationRef,
          },
        );
        expect(result.kind).toBe("outcome_unknown");
        expect(faults.launchCalls).toHaveLength(1);
        expect(faults.observationCalls).toHaveLength(1);
        expect(faults.createdEffectCount).toBe(1);
      }
    });

    it("extracts declared usage and marks applicable missing usage unknown", async () => {
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch(
        responseStep(
          subject.fixtures.successWithUsage,
          subject.providerOperationRef,
        ),
      );
      const outcome = await executeProviderEffect(
        subject.createAdapter(faults),
        subject.request,
      );
      expect(outcome.kind).toBe("succeeded");
      expect(outcome.usage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "reported",
            quantity: expect.any(String),
          }),
        ]),
      );

      const missing = new DeterministicProviderFaultKit();
      missing.enqueueLaunch(
        responseStep(subject.fixtures.success, subject.providerOperationRef),
      );
      const missingOutcome = await executeProviderEffect(
        subject.createAdapter(missing),
        subject.request,
      );
      expect(missingOutcome.usage).toContainEqual({
        dimension: "provider.tokens.input@1",
        unit: "count",
        source: "unknown",
        quantity: null,
      });
      expect(missingOutcome.usage).toContainEqual({
        dimension: "provider.tokens.output@1",
        unit: "count",
        source: "unknown",
        quantity: null,
      });
    });

    it("sanitizes credentials, raw provider bodies, and thrown errors", async () => {
      const secret = Object.values(subject.request.credentials)[0]?.secret;
      if (!secret) throw new TypeError("Conformance request requires a canary secret.");
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch(
        responseStep(
          subject.fixtures.secretBearingMalformed(secret),
          subject.providerOperationRef,
        ),
      );
      const malformed = await executeProviderEffect(
        subject.createAdapter(faults),
        subject.request,
      );
      expect(JSON.stringify(malformed)).not.toContain(secret);

      const binary = new DeterministicProviderFaultKit();
      binary.enqueueLaunch(
        responseStep(
          subject.fixtures.successWithSecretOutput(secret),
          subject.providerOperationRef,
        ),
      );
      const binaryLeak = await executeProviderEffect(
        subject.createAdapter(binary),
        subject.request,
      );
      expect(binaryLeak).toMatchObject({
        kind: "outcome_unknown",
        failureCode: "PROVIDER_ADAPTER_EXCEPTION",
      });
      expect(JSON.stringify(binaryLeak)).not.toContain(secret);

      const throwing: ProviderAdapter<I, O> = {
        ...subject.createAdapter(new DeterministicProviderFaultKit()),
        execute: async () => {
          throw new Error(`unsafe ${secret}`);
        },
      };
      const normalized = await executeProviderEffect(throwing, subject.request);
      expect(normalized).toMatchObject({
        kind: "outcome_unknown",
        failureCode: "PROVIDER_ADAPTER_EXCEPTION",
      });
      expect(JSON.stringify(normalized)).not.toContain(secret);
    });

    it("rejects Artifact, Run, Delivery, retry scheduling, and event escape fields", async () => {
      const faults = new DeterministicProviderFaultKit();
      faults.enqueueLaunch(
        responseStep(subject.fixtures.success, subject.providerOperationRef),
      );
      const valid = await subject.createAdapter(faults).execute(subject.request);
      for (const forbidden of [
        { artifactId: "artifact_escape" },
        { run: { state: "completed" } },
        { delivery: { state: "succeeded" } },
        { retryAt: "2026-08-01T00:00:00.000Z" },
        { events: [{ type: "run.completed" }] },
      ]) {
        expect(() =>
          parseProviderOutcome(subject.createAdapter(faults).contract, {
            ...valid,
            ...forbidden,
          }),
        ).toThrow("Provider Adapter violated its normalized contract.");
      }
    });
  });
}
