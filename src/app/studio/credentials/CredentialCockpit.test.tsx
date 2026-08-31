import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialCockpit } from "./CredentialCockpit";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) =>
        key === "node-banana-active-workspace-id" ? "workspace-1" : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 1,
    },
  });
});

describe("CredentialCockpit", () => {
  it("renders redacted metadata, password handoff, and explicit spend modes", async () => {
    fetchMock.mockImplementation(
      async (_input: RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          capability: string;
        };
        const result =
          request.capability === "credentials.profiles.list@1"
            ? {
                profiles: [
                  {
                    id: "profile-1",
                    workspaceId: "workspace-1",
                    name: "Replicate production",
                    provider: "replicate",
                    slotId: "slot-1",
                    slotName: "image-primary",
                    status: "active",
                    activeVersion: 2,
                    secretHint: "••••1234",
                    rotatedAt: "2026-07-25T00:00:00.000Z",
                    reprovisionable: false,
                  },
                ],
              }
            : request.capability === "credentials.spend_grants.list@1"
              ? { grants: [] }
              : { events: [] };
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result }),
        };
      },
    );

    render(<CredentialCockpit />);

    const secret = screen.getByPlaceholderText("Secret handoff");
    expect(secret).toHaveAttribute("type", "password");
    expect(screen.getByRole("option", { name: "Bounded spend" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Audited unbounded spend" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText("Replicate production")).toHaveLength(2),
    );
    expect(screen.getByText("••••1234")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("replicate-private-key");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/studio/credentials/capabilities",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.any(Headers),
      }),
    );
    const request = fetchMock.mock.calls.find(
      ([url]) => url === "/api/studio/credentials/capabilities",
    )?.[1] as RequestInit;
    expect(new Headers(request.headers).get("x-workspace-id")).toBe(
      "workspace-1",
    );
  });

  it("reuses one idempotency key when the same submit is retried after a lost response", async () => {
    const mutationKeys: string[] = [];
    let createAttempts = 0;
    fetchMock.mockImplementation(
      async (_input: RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          capability: string;
        };
        if (request.capability === "credentials.profiles.create@1") {
          createAttempts += 1;
          mutationKeys.push(
            new Headers(init?.headers).get("idempotency-key") ?? "",
          );
          if (createAttempts === 1) {
            throw new Error("response lost");
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, result: { id: "profile-1" } }),
          };
        }
        const result =
          request.capability === "credentials.profiles.list@1"
            ? { profiles: [] }
            : request.capability === "credentials.spend_grants.list@1"
              ? { grants: [] }
              : { events: [] };
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result }),
        };
      },
    );
    render(<CredentialCockpit />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const submit = async () => {
      fireEvent.change(screen.getByPlaceholderText("Profile name"), {
        target: { value: "Production" },
      });
      fireEvent.change(screen.getByPlaceholderText("Provider"), {
        target: { value: "openai" },
      });
      fireEvent.change(screen.getByPlaceholderText("Logical slot"), {
        target: { value: "primary" },
      });
      fireEvent.change(screen.getByPlaceholderText("Secret handoff"), {
        target: { value: "sk-private-value" },
      });
      fireEvent.submit(
        screen.getByRole("button", {
          name: "Vault Credential Profile",
        }).closest("form")!,
      );
    };

    await submit();
    await waitFor(() => expect(createAttempts).toBe(1));
    await submit();
    await waitFor(() => expect(createAttempts).toBe(2));

    expect(mutationKeys[0]).toBeTruthy();
    expect(mutationKeys[1]).toBe(mutationKeys[0]);
  });

  it("offers reprovision, not unsafe enable, after emergency revocation", async () => {
    fetchMock.mockImplementation(
      async (_input: RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          capability: string;
        };
        const result =
          request.capability === "credentials.profiles.list@1"
            ? {
                profiles: [
                  {
                    id: "profile-revoked",
                    workspaceId: "workspace-1",
                    name: "Emergency revoked",
                    provider: "openai",
                    slotId: "slot-revoked",
                    slotName: "primary",
                    status: "disabled",
                    activeVersion: null,
                    secretHint: null,
                    rotatedAt: null,
                    reprovisionable: true,
                  },
                ],
              }
            : request.capability === "credentials.spend_grants.list@1"
              ? { grants: [] }
              : { events: [], nextCursor: null };
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result }),
        };
      },
    );

    render(<CredentialCockpit />);
    await screen.findByText("Emergency revoked");

    expect(
      screen.queryByRole("button", { name: "Enable" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rotate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reprovision legacy profile" }),
    ).toBeInTheDocument();
  });

  it("drives the complete manager lifecycle through canonical capabilities", async () => {
    const mutations: Array<{ capability: string; input: Record<string, unknown>; key: string | null }> = [];
    fetchMock.mockImplementation(
      async (_input: RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          capability: string;
          input: Record<string, unknown>;
        };
        if (request.capability === "credentials.profiles.list@1") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: {
                profiles: [
                  {
                    id: "profile-active",
                    workspaceId: "workspace-1",
                    name: "Active provider",
                    provider: "openai",
                    slotId: "slot-active",
                    slotName: "primary",
                    status: "active",
                    activeVersion: 2,
                    secretHint: "••••1234",
                    rotatedAt: "2026-07-25T00:00:00.000Z",
                    reprovisionable: false,
                  },
                  {
                    id: "profile-legacy",
                    workspaceId: "workspace-1",
                    name: "Legacy provider",
                    provider: "replicate",
                    slotId: null,
                    slotName: null,
                    status: "disabled",
                    activeVersion: null,
                    secretHint: null,
                    rotatedAt: null,
                    reprovisionable: true,
                  },
                ],
              },
            }),
          };
        }
        if (request.capability === "credentials.spend_grants.list@1") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: {
                grants: [
                  {
                    id: "grant-1",
                    principalId: "agent-1",
                    mode: "bounded",
                    limitCents: 100,
                    spentCents: 4,
                    status: "active",
                  },
                ],
              },
            }),
          };
        }
        if (request.capability === "credentials.audit.list@1") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: { events: [], nextCursor: null },
            }),
          };
        }
        mutations.push({
          capability: request.capability,
          input: request.input,
          key: new Headers(init?.headers).get("idempotency-key"),
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { accepted: true } }),
        };
      },
    );

    render(<CredentialCockpit />);
    await screen.findAllByText("Active provider");

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(mutations.some((item) => item.capability === "credentials.profiles.status.set@1")).toBe(true),
    );

    fireEvent.change(screen.getByLabelText("New secret for Active provider"), {
      target: { value: "sk-rotated-value" },
    });
    fireEvent.change(
      screen.getByLabelText("Rotation overlap seconds for Active provider"),
      { target: { value: "60" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    await waitFor(() =>
      expect(mutations.some((item) => item.capability === "credentials.profiles.rotate@1")).toBe(true),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Emergency revoke v2" }),
    );
    await waitFor(() =>
      expect(mutations.some((item) => item.capability === "credentials.versions.revoke@1")).toBe(true),
    );

    fireEvent.change(screen.getByLabelText("Logical slot for Legacy provider"), {
      target: { value: "legacy-primary" },
    });
    fireEvent.change(
      screen.getByLabelText("Replacement secret for Legacy provider"),
      { target: { value: "replicate-new-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reprovision legacy profile" }),
    );
    await waitFor(() =>
      expect(mutations.some((item) => item.capability === "credentials.profiles.reprovision@1")).toBe(true),
    );

    fireEvent.change(screen.getByPlaceholderText("Agent Principal ID"), {
      target: { value: "agent-2" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "profile-active" },
    });
    fireEvent.change(screen.getByPlaceholderText("Bound in cents"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Spend Grant" }));
    await waitFor(() =>
      expect(mutations.some((item) => item.capability === "credentials.spend_grants.create@1")).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(mutations.some((item) => item.capability === "credentials.spend_grants.revoke@1")).toBe(true),
    );

    for (const identity of [
      "credentials.profiles.rotate@1",
      "credentials.profiles.reprovision@1",
      "credentials.spend_grants.create@1",
    ]) {
      expect(mutations.find((item) => item.capability === identity)?.key).toBeTruthy();
    }
    expect(mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "credentials.profiles.status.set@1",
          input: { profileId: "profile-active", status: "disabled" },
        }),
        expect.objectContaining({
          capability: "credentials.profiles.rotate@1",
          input: expect.objectContaining({
            profileId: "profile-active",
            expectedActiveVersion: 2,
            overlapSeconds: 60,
          }),
        }),
        expect.objectContaining({
          capability: "credentials.versions.revoke@1",
          input: { profileId: "profile-active", version: 2 },
        }),
        expect.objectContaining({
          capability: "credentials.spend_grants.revoke@1",
          input: { grantId: "grant-1" },
        }),
      ]),
    );
  });
});
