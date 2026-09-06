import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObservabilityCockpit } from "./ObservabilityCockpit";
import { I18nTestProvider } from "@/test/i18n";

const renderCockpit = () => render(<I18nTestProvider locale="en"><ObservabilityCockpit /></I18nTestProvider>);

function resultFor(capability: string) {
  if (capability === "operational_metrics.list@1") {
    return {
      schema: "operational-metric-page/v1",
      items: [{
        schema: "operational-metric-aggregate/v1",
        name: "runtime.run.count",
        dimensions: [{ key: "status", value: "completed" }],
        count: 2,
        sum: 2,
        recordedAt: "2026-08-01T12:00:00.000Z",
      }],
      nextCursor: null,
    };
  }
  if (capability === "observability_retention.get@1") {
    return {
      revision: {
        id: "revision_2",
        metricTtlSeconds: 1200,
        traceTtlSeconds: 600,
        supportBundleTtlSeconds: 300,
      },
    };
  }
  if (capability === "telemetry_operator_grants.list@1") {
    return {
      schema: "telemetry-operator-grant-list/v1",
      items: [{
        id: "grant_active",
        scopes: ["trace.read", "support_bundle.read"],
        status: "active",
        expiresAt: "2026-08-02T12:00:00.000Z",
      }],
    };
  }
  if (capability === "support_bundles.payload.get@1") {
    return {
      bundle: { id: "bundle_1", state: "stored", selections: [], sizeBytes: 80 },
      content: { mediaType: "application/json", encoding: "base64", data: "e30=", digest: `sha256:${"a".repeat(64)}`, sizeBytes: 2 },
    };
  }
  if (capability === "support_bundle_audit.list@1") {
    return { schema: "support-bundle-audit-list/v1", items: [] };
  }
  if (capability === "support_bundles.create@1") {
    return { id: "bundle_created", state: "stored", selections: [], sizeBytes: 80 };
  }
  return {};
}

describe("ObservabilityCockpit", () => {
  const requests: Array<{ capability: string; input: Record<string, unknown> }> = [];

  beforeEach(() => {
    requests.length = 0;
    localStorage.setItem("node-banana-active-workspace-id", "workspace_1");
    vi.stubGlobal("crypto", { randomUUID: () => "request-key-123" });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        capability: string;
        input: Record<string, unknown>;
      };
      requests.push(request);
      return new Response(JSON.stringify({
        success: true,
        capability: request.capability,
        result: resultFor(request.capability),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  it("hydrates retention and context-bound grant controls from canonical reads", async () => {
    renderCockpit();
    await waitFor(() => expect(screen.getByLabelText("Trace seconds")).toHaveValue(600));
    expect(screen.getByLabelText("Metric seconds")).toHaveValue(1200);
    expect(screen.getByLabelText("Bundle seconds")).toHaveValue(300);
    expect(screen.getByLabelText("Trace Operator Grant ID")).toHaveValue("grant_active");
    expect(screen.getByLabelText("Bundle Operator Grant ID")).toHaveValue("grant_active");
    expect(screen.getByText("status=completed")).toBeInTheDocument();
  });

  it("reads payload once before audit without a duplicate metadata read", async () => {
    renderCockpit();
    await screen.findByLabelText("Bundle Operator Grant ID");
    fireEvent.change(screen.getByLabelText("Bundle ID"), { target: { value: "bundle_1" } });
    fireEvent.submit(screen.getByLabelText("Bundle ID").closest("form")!);
    await screen.findByText(/bundle_1/);
    const bundleReads = requests
      .map((request) => request.capability)
      .filter((capability) => capability.startsWith("support_bundle"));
    expect(bundleReads).toEqual([
      "support_bundles.payload.get@1",
      "support_bundle_audit.list@1",
    ]);
  });

  it("submits only exact selections and consent, never digests or identity", async () => {
    renderCockpit();
    await screen.findByLabelText("Support resource kind");
    fireEvent.change(screen.getByLabelText("Support resource kind"), {
      target: { value: "artifact" },
    });
    fireEvent.change(screen.getByLabelText("Support resource ID"), {
      target: { value: "artifact_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByText(/I explicitly consent/));
    fireEvent.click(screen.getByRole("button", { name: "Freeze bundle" }));
    await waitFor(() =>
      expect(requests.some((request) => request.capability === "support_bundles.create@1")).toBe(true),
    );
    const create = requests.find((request) => request.capability === "support_bundles.create@1")!;
    expect(create.input).toMatchObject({
      selections: [{
        resourceKind: "artifact",
        resourceId: "artifact_1",
        projectionKind: "artifact_metadata",
      }],
      consentConfirmed: true,
    });
    expect(JSON.stringify(create.input)).not.toMatch(/operatorId|workspaceId|digest|sizeBytes|storageKey/);
  });
});
