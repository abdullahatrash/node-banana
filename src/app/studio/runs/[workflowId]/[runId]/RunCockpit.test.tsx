import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunCockpit } from "./RunCockpit";

const digest = (value: string) => `sha256:${value.repeat(64)}`;

function run(state = "outcome_unknown") {
  return {
    id: "run_1",
    workspaceId: "workspace_1",
    workflowId: "workflow_1",
    workflowRevisionId: "revision_1",
    state,
    startSnapshotDigest: digest("a"),
    startSnapshot: {
      schema: "workflow-run-start-snapshot/v2",
      workflowId: "workflow_1",
      workflowRevisionId: "revision_1",
      workflowRevision: 7,
      definitionDigest: digest("b"),
      operationRegistryDigest: digest("c"),
      definition: { steps: [] },
      inputs: [],
      operationContracts: [{ stepId: "copy", identity: "text.generate@1", contractDigest: digest("d") }],
      artifactReferences: [{ inputName: "reference", artifactId: "artifact_input", digest: digest("e"), kind: "image", mediaType: "image/png", sizeBytes: 12, width: 2, height: 2 }],
      credentialReferences: [],
      providerResolutions: [],
      authorization: { principalId: "principal_agent", keyId: "key_1", evidenceRef: "auth_1" },
    },
    output: null,
    finalSnapshot: null,
    finalSnapshotDigest: null,
    derivation: null,
    resumeAt: null,
    failureCode: state === "outcome_unknown"
      ? "PROVIDER_TIMEOUT"
      : state === "failed" ? "PROVIDER_REJECTED" : null,
    acceptedAt: "2026-08-09T00:00:00.000Z",
    startedAt: "2026-08-09T00:00:01.000Z",
    completedAt: null,
    updatedAt: "2026-08-09T00:00:02.000Z",
  };
}

const attempt = {
  id: "attempt_1",
  workspaceId: "workspace_1",
  runId: "run_1",
  stepId: "copy",
  attempt: 1,
  state: "outcome_unknown",
  operationIdentity: "text.generate@1",
  operationContractDigest: digest("d"),
  provider: "google",
  providerOperation: "generate",
  model: "gemini-test",
  intentDigest: digest("f"),
  effectKey: "workflow-effect:v1:run_1:copy:1",
  inputs: [],
  outputs: { copy: { artifactId: "artifact_output", digest: digest("1"), kind: "text", mediaType: "text/plain", sizeBytes: 10 } },
  providerOperationRef: "operation_1",
  outcome: { kind: "outcome_unknown", failureCode: "PROVIDER_TIMEOUT", priorSucceededProviderOperationRef: null },
  providerMetadata: {
    evidence: { providerRequestId: null, httpStatus: null, providerCode: null, operatorTraceRef: "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", effectDisposition: "outcome_unknown" },
    usage: [], retryAfterMs: null, pollAfterMs: null,
  },
  reconciliation: null,
  failureCode: "PROVIDER_TIMEOUT",
  startedAt: "2026-08-09T00:00:01.000Z",
  completedAt: null,
};

function artifact(id: "artifact_input" | "artifact_output") {
  const generated = id === "artifact_output";
  return {
    artifact: {
      id,
      workspaceId: "workspace_1",
      kind: generated ? "text" : "image",
      digest: generated ? digest("1") : digest("e"),
      sizeBytes: generated ? 10 : 12,
      mediaType: generated ? "text/plain; charset=utf-8" : "image/png",
      width: generated ? null : 2,
      height: generated ? null : 2,
      creatorPrincipalId: "principal_agent",
      origin: generated ? {
        kind: "generated",
        generatedAt: "2026-08-09T00:00:02.000Z",
        workflowRevision: { workflowId: "workflow_1", revisionId: "revision_1", revision: 7, definitionDigest: digest("b") },
        run: { runId: "run_1", startSnapshotDigest: digest("a") },
        stepAttempt: { stepAttemptId: "attempt_1", stepId: "copy", attempt: 1 },
        providerOperation: { provider: "google", operationIdentity: "text.generate@1", operation: "generate", ref: "operation_1", model: "gemini-test", intentDigest: digest("f"), metadata: null },
        effectKey: "workflow-effect:v1:run_1:copy:1",
        outputName: "copy",
      } : { kind: "imported", importedAt: "2026-08-08T00:00:00.000Z" },
      retention: { mode: "workspace_default", snapshotAt: "2026-08-09T00:00:00.000Z" },
      lineage: { inputs: generated ? [{ port: "reference", kind: "image", source: { kind: "workflow_input", inputName: "reference" }, contentDigest: digest("e"), artifactId: "artifact_input" }] : [], sourceArtifactIds: generated ? ["artifact_input"] : [] },
      createdAt: "2026-08-09T00:00:00.000Z",
    },
    textContent: generated ? "Canonical generated copy" : null,
  };
}

function response(result: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400
    ? { success: true, result }
    : result), { status, headers: { "content-type": "application/json" } });
}

function installFetch(options: {
  state?: string;
  failAttempts?: boolean;
  eventAuthorizationLoss?: boolean;
  usageAuthorizationLoss?: boolean;
  traceDenied?: boolean;
  traceSessionExpired?: boolean;
} = {}) {
  const calls: Array<{ capability: string; input: Record<string, unknown> }> = [];
  let retainedSecondEvent = false;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { capability: string; input: Record<string, unknown> };
    calls.push(body);
    if (body.capability === "workflow_runs.get@2") return response(run(options.state));
    if (body.capability === "workflow_versions.get@2") return response({ id: "revision_1", workspaceId: "workspace_1", workflowId: "workflow_1", revision: 7, definitionDigest: digest("b"), operationRegistryDigest: digest("c"), definition: { schema: "content-workflow-revision-definition/v1", workflowId: "workflow_1", name: "Canonical copy", inputs: {}, credentialSlots: {}, steps: [], outputs: {} }, author: { principalId: "principal_agent", keyId: "key_1", authorizationEvidenceRef: "evidence_1" }, createdAt: "2026-08-09T00:00:00.000Z" });
    if (body.capability === "workflow_step_attempts.list@2") {
      const currentAttempt = options.state === "failed"
        ? { ...attempt, state: "failed", outcome: { kind: "failed_known", failureCode: "PROVIDER_REJECTED", retryable: false }, failureCode: "PROVIDER_REJECTED", completedAt: "2026-08-09T00:00:02.000Z" }
        : attempt;
      return options.failAttempts
        ? response({ success: false, error: "Step Attempts are temporarily unavailable.", operatorTraceRef: "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, 500)
        : response({ items: [currentAttempt] });
    }
    if (body.capability === "workflow_run_events.list@2") {
      if (body.input.cursor && options.eventAuthorizationLoss) {
        return response({ success: false, error: "No access.", code: "CAPABILITY_NOT_AUTHORIZED" }, 403);
      }
      const first = { id: "event_1", runId: "run_1", sequence: 1, type: "run.accepted", data: {}, occurredAt: "2026-08-09T00:00:00.000Z" };
      const second = { id: "event_2", runId: "run_1", sequence: 2, type: "step.attempt.outcome_unknown", data: {}, occurredAt: "2026-08-09T00:00:02.000Z" };
      if (body.input.cursor) {
        retainedSecondEvent = true;
        return response({ items: [second], nextCursor: "cursor_2" });
      }
      return response({ items: retainedSecondEvent ? [first, second] : [first], nextCursor: retainedSecondEvent ? "cursor_2" : "cursor_1" });
    }
    if (body.capability === "workflow_run_artifacts.get@2") return response(artifact(body.input.artifactId as "artifact_input" | "artifact_output"));
    if (body.capability === "usage_records.list@1") {
      if (body.input.cursor && options.usageAuthorizationLoss) return response({ success: false, error: "No access.", code: "CAPABILITY_NOT_AUTHORIZED" }, 403);
      return response({ schema: "usage-record-page/v1", items: [{ schema: "usage-record/v1", id: "usage_1", settlementId: "settlement_1", binding: { workspaceId: "workspace_1", principalId: "principal_agent", workflowId: "workflow_1", runId: "run_1", stepAttemptId: "attempt_1", stepId: "copy", attempt: 1, provider: "google", providerOperation: "generate", providerOperationRef: null, model: "gemini-test", effectKey: "workflow-effect:v1:run_1:copy:1" }, interval: { startedAt: "2026-08-09T00:00:01.000Z", endedAt: "2026-08-09T00:00:02.000Z" }, dimension: "tokens.input@1", unit: "count", source: "unknown", quantity: null, outcome: "outcome_unknown", directArtifactId: "artifact_output", lineageArtifactIds: ["artifact_input"], evidence: { providerRequestId: null, httpStatus: null, providerCode: null, operatorTraceRef: "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", effectDisposition: "outcome_unknown" }, supersedesUsageRecordId: null, correctionReason: null, recordedAt: "2026-08-09T00:00:02.000Z" }], nextCursor: options.usageAuthorizationLoss ? "usage_cursor_1" : null });
    }
    if (body.capability === "cost_valuations.list@1") return response({ items: [{ id: "cost_1", basis: "unknown", pricingSource: "unknown", amount: null, currency: null, pricingSnapshotIds: [], supersedesCostValuationId: null }], nextCursor: null });
    if (body.capability === "usage_summaries.get@1") return response({ schema: "usage-summary/v1", quantityTotals: [], complete: false, unknownValuationCount: 1, costSubtotals: [{ currency: "USD", amount: "1.25", knownCount: 1 }, { currency: "EUR", amount: "2.00", knownCount: 1 }] });
    if (body.capability === "budget_reservations.list@1") return response({ schema: "budget-reservation-list/v1", items: [{ id: "budget_1", state: "held", reservedAmount: "3.00", heldAmount: "3.00", settledAmount: "0", releasedAmount: "0", currency: "USD" }] });
    if (body.capability === "quota_reservations.list@1") return response({ schema: "quota-reservation-list/v1", items: [{ id: "quota_1", state: "held", dimension: "run.concurrent@1", unit: "count", reservedAmount: "1", heldAmount: "1", settledAmount: "0", releasedAmount: "0", overageAmount: "0" }] });
    if (body.capability === "quota_waits.list@1") return response({ items: [{ id: "wait_1", state: "waiting", eligibleAt: null }] });
    if (body.capability === "diagnostic_traces.get@1") {
      if (options.traceSessionExpired) {
        return response({ success: false, error: "Please sign in." }, 401);
      }
      return options.traceDenied
        ? response({ success: false, error: "The selected observability resource is unavailable.", code: "OBSERVABILITY_UNAVAILABLE" }, 404)
        : response({ schema: "diagnostic-trace/v1", operatorTraceRef: "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", category: "provider", severity: "warning", code: "PROVIDER_TIMEOUT", stage: "execution", outcome: "unknown", providerFamily: "google", httpStatus: null, retryable: true, durationMs: 900, attempt: 1, createdAt: "2026-08-09T00:00:02.000Z", expiresAt: "2026-08-10T00:00:02.000Z", rawProviderBody: "must-not-render" });
    }
    throw new Error(`Unhandled capability ${body.capability}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("RunCockpit", () => {
  beforeEach(() => {
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace_1");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders immutable partial/unknown evidence, imported inputs, lineage, and unknown cost without inventing zero", async () => {
    installFetch();
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading canonical Run evidence");
    expect(await screen.findByText("outcome unknown")).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => element?.tagName === "P" && element.textContent?.includes("Revision 7") === true).length).toBeGreaterThan(0);
    expect(screen.getByText((_, element) => element?.tagName === "STRONG" && element.textContent === "Input · image")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "STRONG" && element.textContent === "Output · text")).toBeInTheDocument();
    expect(screen.getByText("Canonical generated copy")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("direct charge attribution artifact_output") === true)).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Non-charge lineage context: artifact_input")).toBeInTheDocument();
    expect(screen.getByText("Contains unknown usage or pricing; unknown is not zero.")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "LI" && element.textContent?.includes("held · reserved 3.00 USD") === true)).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "LI" && element.textContent?.includes("held · run.concurrent@1 · reserved 1 count") === true)).toBeInTheDocument();
    expect(screen.getAllByText("Showing up to 100 rows; this capability does not expose continuation.")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Cost Valuations" })).queryByText(/^0(?:\.0+)?(?:\s|$)/)).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Canonical Run snapshots" })).toBeInTheDocument();
    expect(screen.getByText("Exact immutable definition")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sanitized diagnostics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Operator Trace Reference")).toBeInTheDocument();
  });

  it("continues the Human-bound event cursor without duplicates and reload reconstructs the same view", async () => {
    const { calls } = installFetch();
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    expect(await screen.findByText("#1", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for retained updates" }));
    expect(await screen.findByText("#2", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("#1", { exact: false })).toHaveLength(1);
    expect(calls.find((call) => call.capability === "workflow_run_events.list@2" && call.input.cursor === "cursor_1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload canonical view" }));
    await waitFor(() => expect(calls.filter((call) => call.capability === "workflow_run_events.list@2" && !call.input.cursor)).toHaveLength(2));
    expect(screen.getAllByText("#1", { exact: false })).toHaveLength(1);
    expect(screen.getAllByText("#2", { exact: false })).toHaveLength(1);
  });

  it("keeps independent panel failures partial and opens only allowlisted diagnostics with an active grant", async () => {
    installFetch({ failAttempts: true });
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    expect(await screen.findByText("Step Attempts are temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "STRONG" && element.textContent === "Input · image")).toBeInTheDocument();
    const diagnostics = screen.getByRole("region", { name: "Sanitized diagnostics" });
    expect(within(diagnostics).getByLabelText("Operator Trace Reference")).toHaveValue("otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(within(diagnostics).getByText("otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeInTheDocument();
    fireEvent.change(within(diagnostics).getByLabelText("Active trace.read Grant ID"), { target: { value: "grant_trace_1" } });
    fireEvent.click(within(diagnostics).getByRole("button", { name: "Open sanitized trace" }));
    expect(await within(diagnostics).findByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
  });

  it("clears protected evidence and stops polling immediately on authorization loss", async () => {
    vi.useFakeTimers();
    const { fetchMock } = installFetch({ eventAuthorizationLoss: true });
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("outcome unknown")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText("Authorization was lost.", { exact: false })).toBeInTheDocument();
    const callsAfterLoss = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterLoss);
    expect(screen.queryByText("Canonical generated copy")).not.toBeInTheDocument();
  });

  it("keeps Run evidence visible when a trace grant is revoked", async () => {
    installFetch({ traceDenied: true });
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    expect(await screen.findByText("outcome unknown")).toBeInTheDocument();
    const diagnostics = screen.getByRole("region", { name: "Sanitized diagnostics" });
    fireEvent.change(within(diagnostics).getByLabelText("Operator Trace Reference"), { target: { value: "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } });
    fireEvent.change(within(diagnostics).getByLabelText("Active trace.read Grant ID"), { target: { value: "revoked_grant" } });
    fireEvent.click(within(diagnostics).getByRole("button", { name: "Open sanitized trace" }));
    expect(await within(diagnostics).findByText("Diagnostic Trace is unavailable for this grant.")).toBeInTheDocument();
    expect(screen.getByText("outcome unknown")).toBeInTheDocument();
  });

  it("clears protected evidence and stops polling when diagnostic inspection reports session loss", async () => {
    vi.useFakeTimers();
    const { fetchMock } = installFetch({ traceSessionExpired: true });
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("outcome unknown")).toBeInTheDocument();
    const diagnostics = screen.getByRole("region", { name: "Sanitized diagnostics" });
    fireEvent.change(within(diagnostics).getByLabelText("Operator Trace Reference"), { target: { value: "otr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } });
    fireEvent.change(within(diagnostics).getByLabelText("Active trace.read Grant ID"), { target: { value: "grant_trace_1" } });
    fireEvent.click(within(diagnostics).getByRole("button", { name: "Open sanitized trace" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("Authorization was lost.", { exact: false })).toBeInTheDocument();
    const callsAfterLoss = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterLoss);
    expect(screen.queryByText("Canonical generated copy")).not.toBeInTheDocument();
  });

  it("renders an explicitly failed Run and failed-known Step Attempt distinctly", async () => {
    installFetch({ state: "failed" });
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    expect(await screen.findAllByText("failed")).toHaveLength(2);
    expect(screen.getByText("failed_known · PROVIDER_REJECTED")).toBeInTheDocument();
  });

  it("clears protected evidence when a paged Usage authorization recheck fails", async () => {
    installFetch({ usageAuthorizationLoss: true });
    render(<RunCockpit workflowId="workflow_1" runId="run_1" />);
    expect(await screen.findByText("outcome unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more usage" }));
    expect(await screen.findByText("Authorization was lost.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("artifact_output", { exact: false })).not.toBeInTheDocument();
  });
});
