import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublishingApprovalDto,
  PublishingApprovalPresentation,
} from "@/lib/agent-runtime/publishing-approvals/types";
import { PublishingApprovalCockpit } from "./PublishingApprovalCockpit";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

function approval(status: PublishingApprovalDto["status"] = "pending") {
  return {
    id: "par_request_1",
    workspaceId: "workspace_1",
    planId: "plan_1",
    planRevisionId: "ppr_revision_7",
    planRevision: 7,
    planRevisionDigest: DIGEST,
    action: "publish",
    targetIds: ["target_1"],
    channelIds: ["channel_1"],
    artifactIds: ["artifact_text_1"],
    requestingPrincipalId: "principal_agent_1",
    requestingKeyId: "key_1",
    requestAuthorization: {
      capability: "publishing_approvals.request@1",
      contractDigest: OTHER_DIGEST,
      evidenceRef: "otr_safe_reference",
      resources: {
        channelIds: ["channel_1"],
        artifactIds: ["artifact_text_1"],
      },
    },
    validation: {
      evidenceDigest: DIGEST,
      currentStateDigest: OTHER_DIGEST,
      contextId: "context_1",
      contextDigest: DIGEST,
      evaluatedAt: "2026-08-08T12:00:00.000Z",
      expiresAt: "2026-08-08T13:00:00.000Z",
      runtimePolicyIdentity: "publishing-runtime-policy/default@1",
      runtimePolicyContractDigest: OTHER_DIGEST,
    },
    decisionPolicy: {
      mode: "expires_at",
      expiresAt: "2026-08-08T13:00:00.000Z",
    },
    createdAt: "2026-08-08T12:00:00.000Z",
    status,
    inspectionDigest: DIGEST,
    decision: null,
    consumption: null,
    authorizesExecution: false,
  } satisfies PublishingApprovalDto;
}

function presentation(covered = true): PublishingApprovalPresentation {
  return {
    schema: "publishing-approval-presentation/v1",
    approval: approval(),
    targets: [
      {
        targetId: "target_1",
        channel: {
          id: "channel_1",
          platform: "linkedin",
          authorKind: "organization",
          displayName: "Node Banana, Inc.",
          historical: false,
        },
        content: {
          artifactId: "artifact_text_1",
          digest: DIGEST,
          mediaType: "text/plain; charset=utf-8",
          text: "Exact launch copy\nwith a second line.",
        },
        media: [],
        settings: { type: "organization" },
        timing: {
          kind: "scheduled",
          publishAt: "2026-08-08T12:30:00.000Z",
        },
        targetEvidenceDigest: DIGEST,
        validation: {
          evaluatedAt: "2026-08-08T12:00:00.000Z",
          expiresAt: "2026-08-08T13:00:00.000Z",
          channelSnapshot: {
            id: "channel_1",
            platform: "linkedin",
            authorKind: "organization",
            snapshotDigest: DIGEST,
            capabilityVersion: "linkedin@1",
          },
          artifacts: {
            content: {
              id: "artifact_text_1",
              digest: DIGEST,
              snapshotDigest: OTHER_DIGEST,
              kind: "text",
              mediaType: "text/plain; charset=utf-8",
              sizeBytes: 42,
            },
            media: [],
          },
          settingsDigest: OTHER_DIGEST,
          publishAt: "2026-08-08T12:30:00.000Z",
          policy: {
            identity: "publishing-runtime-policy/default@1",
            contractDigest: OTHER_DIGEST,
            evidenceDigest: DIGEST,
            stateDigest: OTHER_DIGEST,
            outcome: "allowed",
            blockerCodes: [],
          },
        },
        costContext: {
          authoritative: false,
          currency: "USD",
          estimatedAmount: "0.42",
          pricingSnapshotIds: ["pricing_1"],
          computedAt: "2026-08-08T12:00:00.000Z",
        },
      },
    ],
    authorityCoverage: [
      {
        targetId: "target_1",
        channelId: "channel_1",
        action: "publish",
        covered,
        grantRefs: covered ? ["grant_1"] : [],
      },
    ],
    decisionEligibility: {
      eligible: covered,
      blockerCodes: covered ? [] : ["AUTHORITY_MISSING"],
    },
  };
}

function supersededPresentation(): PublishingApprovalPresentation {
  const value = presentation(true);
  return {
    ...value,
    decisionEligibility: {
      eligible: false,
      blockerCodes: ["REVISION_SUPERSEDED"],
    },
  };
}

function partiallyCoveredPresentation(): PublishingApprovalPresentation {
  const value = presentation(true);
  value.approval = {
    ...value.approval,
    targetIds: ["target_1", "target_2"],
    channelIds: ["channel_1", "channel_2"],
    artifactIds: ["artifact_text_1", "artifact_text_2"],
  };
  value.targets.push({
    ...value.targets[0]!,
    targetId: "target_2",
    channel: {
      ...value.targets[0]!.channel,
      id: "channel_2",
      displayName: "Second LinkedIn Page",
    },
    content: {
      ...value.targets[0]!.content,
      artifactId: "artifact_text_2",
      text: "Second exact target copy.",
    },
    validation: {
      ...value.targets[0]!.validation,
      channelSnapshot: {
        ...value.targets[0]!.validation.channelSnapshot,
        id: "channel_2",
      },
      artifacts: {
        content: {
          ...value.targets[0]!.validation.artifacts.content,
          id: "artifact_text_2",
        },
        media: [],
      },
    },
  });
  value.authorityCoverage.push({
    targetId: "target_2",
    channelId: "channel_2",
    action: "publish",
    covered: false,
    grantRefs: [],
  });
  value.decisionEligibility = {
    eligible: false,
    blockerCodes: ["AUTHORITY_MISSING"],
  };
  return value;
}

function installFetch(value: PublishingApprovalPresentation) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, approval: value.approval }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("?limit=")) {
        return new Response(JSON.stringify({ success: true, items: [value.approval] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, presentation: value }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("PublishingApprovalCockpit", () => {
  beforeEach(() => {
    localStorage.setItem("node-banana-active-workspace-id", "workspace_1");
    vi.stubGlobal("crypto", { randomUUID: () => "human-decision-key-123" });
  });

  it("presents exact publishing inputs, validation evidence, and cost context", async () => {
    installFetch(presentation());
    render(<PublishingApprovalCockpit />);

    expect(await screen.findByText("Exact launch copy", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Node Banana, Inc.")).toBeInTheDocument();
    expect(screen.getByText("target_1")).toBeInTheDocument();
    expect(screen.getByText("Author type: organization")).toBeInTheDocument();
    expect(screen.getByText(/0.42 USD/)).toBeInTheDocument();
    expect(screen.getByText(/Non-authoritative estimate/)).toBeInTheDocument();
    expect(screen.getByText("publishing-runtime-policy/default@1")).toBeInTheDocument();
    expect(screen.getByText(/Capability: linkedin@1/)).toBeInTheDocument();
    expect(screen.getByText(/Outcome:/)).toHaveTextContent(
      "Outcome: allowed · blockers: none",
    );
    expect(screen.getByText(/Content:/)).toHaveTextContent(DIGEST);
    expect(
      screen
        .getAllByText(/Snapshot:/)
        .some((element) => element.textContent?.includes(OTHER_DIGEST)),
    ).toBe(true);
    expect(screen.getByText(/authorizesExecution: false/)).toBeInTheDocument();
  });

  it("does not let an owner or admin role substitute for explicit Channel authority", async () => {
    const calls = installFetch(presentation(false));
    render(<PublishingApprovalCockpit />);

    expect(await screen.findByText(/Owner or admin role alone is not sufficient/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/I reviewed the exact content/));
    expect(screen.getByRole("button", { name: "Approve this exact action" })).toBeDisabled();
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  });

  it("requires explicit authority coverage for every affected Channel", async () => {
    installFetch(partiallyCoveredPresentation());
    render(<PublishingApprovalCockpit />);

    expect(await screen.findByText("Second exact target copy.")).toBeInTheDocument();
    expect(screen.getByText("Publish authority covered")).toBeInTheDocument();
    expect(screen.getByText("Publish authority missing")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/I reviewed the exact content/));
    expect(screen.getByRole("button", { name: "Deny permanently" })).toBeDisabled();
  });

  it("sends only the explicit decision and inspected digest with a retry key", async () => {
    const calls = installFetch(presentation());
    render(<PublishingApprovalCockpit />);

    await screen.findByText("Exact launch copy", { exact: false });
    fireEvent.click(screen.getByText(/I reviewed the exact content/));
    fireEvent.click(screen.getByRole("button", { name: "Deny permanently" }));
    await waitFor(() =>
      expect(calls.some((call) => call.init?.method === "POST")).toBe(true),
    );
    const mutation = calls.find((call) => call.init?.method === "POST")!;
    expect(JSON.parse(String(mutation.init?.body))).toEqual({
      decision: "denied",
      expectedInspectionDigest: DIGEST,
    });
    expect(new Headers(mutation.init?.headers).get("idempotency-key")).toBe(
      "human-decision-key-123",
    );
    expect(String(mutation.init?.body)).not.toMatch(
      /userId|workspaceId|channelIds|targetIds|authority|reason/,
    );
  });

  it("keeps superseded evidence inspectable but disables the stale decision", async () => {
    const historical = supersededPresentation();
    historical.targets[0]!.channel = {
      ...historical.targets[0]!.channel,
      displayName: null,
      historical: true,
    };
    const calls = installFetch(historical);
    render(<PublishingApprovalCockpit />);

    expect(await screen.findByText("Exact launch copy", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Historical LinkedIn Channel")).toBeInTheDocument();
    expect(screen.getByText(/Live Channel record unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Plan Revision was superseded.",
    );
    fireEvent.click(screen.getByText(/I reviewed the exact content/));
    expect(screen.getByRole("button", { name: "Approve this exact action" })).toBeDisabled();
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  });

  it("renders denial as final with no second decision controls", async () => {
    const value = presentation(true);
    value.approval = approval("denied");
    installFetch(value);
    render(<PublishingApprovalCockpit />);

    expect(await screen.findByText(/final with status/)).toHaveTextContent("denied");
    expect(
      screen.queryByRole("button", { name: "Approve this exact action" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Deny permanently" }),
    ).not.toBeInTheDocument();
  });

  it("reuses the same decision key after a lost response", async () => {
    const value = presentation();
    let postCount = 0;
    const mutationHeaders: Headers[] = [];
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("retry-stable-key-123")
      .mockReturnValueOnce("must-not-be-used-456");
    vi.stubGlobal("crypto", { randomUUID });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          postCount += 1;
          mutationHeaders.push(new Headers(init.headers));
          if (postCount === 1) {
            return new Response(
              JSON.stringify({ success: false, error: "Response was lost." }),
              { status: 503, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({ success: true, approval: value.approval }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("?limit=")) {
          return new Response(
            JSON.stringify({ success: true, items: [value.approval] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ success: true, presentation: value }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    render(<PublishingApprovalCockpit />);
    await screen.findByText("Exact launch copy", { exact: false });
    fireEvent.click(screen.getByText(/I reviewed the exact content/));
    fireEvent.click(screen.getByRole("button", { name: "Approve this exact action" }));
    await screen.findByText(/Response was lost/);
    fireEvent.click(screen.getByRole("button", { name: "Approve this exact action" }));
    await waitFor(() => expect(postCount).toBe(2));

    expect(mutationHeaders[0]!.get("idempotency-key")).toBe(
      "retry-stable-key-123",
    );
    expect(mutationHeaders[1]!.get("idempotency-key")).toBe(
      "retry-stable-key-123",
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("cannot retarget a decision while another inspection selection is loading", async () => {
    const first = presentation();
    const second = presentation();
    second.approval = {
      ...second.approval,
      id: "par_request_2",
      planRevision: 8,
      inspectionDigest: OTHER_DIGEST,
    };
    second.targets = [
      {
        ...second.targets[0]!,
        content: {
          ...second.targets[0]!.content,
          text: "Second request exact copy.",
        },
      },
    ];
    let resolveSecond!: (response: Response) => void;
    const secondResponse = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const mutations: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          mutations.push({ url, body: JSON.parse(String(init.body)) });
          return new Response(
            JSON.stringify({ success: true, approval: second.approval }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("?limit=")) {
          return new Response(
            JSON.stringify({
              success: true,
              items: [first.approval, second.approval],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("par_request_2")) return secondResponse;
        return new Response(
          JSON.stringify({ success: true, presentation: first }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    render(<PublishingApprovalCockpit />);
    await screen.findByText("Exact launch copy", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /Plan revision 8/ }));
    expect(screen.getByRole("button", { name: /Plan revision 7/ })).toBeDisabled();
    resolveSecond(
      new Response(
        JSON.stringify({ success: true, presentation: second }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await screen.findByText("Second request exact copy.");
    fireEvent.click(screen.getByText(/I reviewed the exact content/));
    fireEvent.click(screen.getByRole("button", { name: "Approve this exact action" }));
    await waitFor(() => expect(mutations).toHaveLength(1));

    expect(mutations[0]).toEqual({
      url: "/api/studio/publishing-approvals/par_request_2",
      body: {
        decision: "approved",
        expectedInspectionDigest: OTHER_DIGEST,
      },
    });
  });

  it("administers an exact grant without sending caller-asserted role or issuer", async () => {
    const value = presentation();
    const mutations: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (
          url === "/api/studio/publishing-approval-authority" &&
          init?.method === "POST"
        ) {
          mutations.push({
            body: JSON.parse(String(init.body)),
            headers: new Headers(init.headers),
          });
          return new Response(
            JSON.stringify({ success: true, grant: { id: "paag_1" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "/api/studio/publishing-approval-authority") {
          return new Response(JSON.stringify({ success: true, grants: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("?limit=")) {
          return new Response(
            JSON.stringify({ success: true, items: [value.approval] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ success: true, presentation: value }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    render(<PublishingApprovalCockpit />);
    await screen.findByText("Exact launch copy", { exact: false });
    fireEvent.change(screen.getByLabelText("Human User ID"), {
      target: { value: "human_subject" },
    });
    fireEvent.change(screen.getByLabelText("LinkedIn Channel ID"), {
      target: { value: "channel_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Issue explicit grant" }));
    await waitFor(() => expect(mutations).toHaveLength(1));

    expect(mutations[0]!.body).toEqual({
      userId: "human_subject",
      channelId: "channel_1",
      expiresAt: null,
    });
    expect(JSON.stringify(mutations[0]!.body)).not.toMatch(
      /subjectRole|issuedByUserId|action|workspaceId/,
    );
    expect(mutations[0]!.headers.get("idempotency-key")).toBe(
      "human-decision-key-123",
    );
  });
});
