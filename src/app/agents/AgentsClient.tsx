"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface Workspace {
  id: string;
  name: string;
  role: "owner" | "admin";
}

interface AgentKey {
  id: string;
  name: string;
  lookupPrefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

interface AgentPrincipal {
  id: string;
  name: string;
  requestedAccess: string[];
  status: "active" | "suspended" | "revoked";
  keys: AgentKey[];
}

async function jsonRequest(
  url: string,
  workspaceId: string,
  fallbackMessage: string,
  init?: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-workspace-id": workspaceId,
      ...init?.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? fallbackMessage);
  return data;
}

export default function AgentsClient() {
  const t = useTranslations("agentManagement");
  const format = useFormatter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [principals, setPrincipals] = useState<AgentPrincipal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/studio/workspaces")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("errors.workspaces"));
        setWorkspaces(
          (data.workspaces ?? []).filter(
            (workspace: { role: string }) =>
              workspace.role === "owner" || workspace.role === "admin",
          ),
        );
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : t("errors.workspaces")),
      );
  }, [t]);

  async function loadAgents(selectedWorkspaceId = workspaceId) {
    if (!selectedWorkspaceId) {
      setPrincipals([]);
      return;
    }
    try {
      setError(null);
      const data = await jsonRequest("/api/agents", selectedWorkspaceId, t("errors.load"));
      setPrincipals(data.principals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.load"));
    }
  }

  async function setStatus(
    principal: AgentPrincipal,
    status: AgentPrincipal["status"],
  ) {
    try {
      setError(null);
      await jsonRequest(`/api/agents/${principal.id}`, workspaceId, t("errors.status"), {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadAgents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.status"));
    }
  }

  async function rotate(principal: AgentPrincipal) {
    const name = window.prompt(t("prompts.keyName"), t("prompts.rotatedKey"));
    if (!name) return;
    const expiryInput = window.prompt(
      t("prompts.expiry"),
      "",
    );
    if (expiryInput === null) return;
    const expiresAt = expiryInput.trim()
      ? new Date(expiryInput.trim())
      : null;
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
      setError(t("errors.invalidExpiry"));
      return;
    }
    try {
      setError(null);
      const data = await jsonRequest(
        `/api/agents/${principal.id}/keys`,
        workspaceId,
        t("errors.rotate"),
        {
          method: "POST",
          body: JSON.stringify({
            name,
            ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
          }),
        },
      );
      setSecret(data.agentKey);
      await loadAgents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.rotate"));
    }
  }

  async function revokeKey(keyId: string) {
    if (!window.confirm(t("confirmRevokeKey"))) return;
    try {
      setError(null);
      await jsonRequest(`/api/agents/keys/${keyId}`, workspaceId, t("errors.revokeKey"), {
        method: "DELETE",
      });
      await loadAgents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.revokeKey"));
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <label className="flex max-w-sm flex-col gap-2 text-sm font-medium">
        {t("workspace")}
        <select
          aria-label={t("workspace")}
          className="h-10 rounded-md border bg-background px-3"
          value={workspaceId}
          onChange={(event) => {
            const next = event.target.value;
            setWorkspaceId(next);
            void loadAgents(next);
          }}
        >
          <option value="">{t("selectWorkspace")}</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.role})
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!workspaceId ? (
        <p className="text-sm text-muted-foreground">
          {t("selectWorkspaceHelp")}
        </p>
      ) : principals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {principals.map((principal) => (
            <section key={principal.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-medium">{principal.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {principal.status} · {principal.requestedAccess.join(", ")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {principal.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void setStatus(principal, "suspended")}
                    >
                      {t("suspend")}
                    </Button>
                  ) : principal.status === "suspended" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void setStatus(principal, "active")}
                    >
                      {t("resume")}
                    </Button>
                  ) : null}
                  {principal.status !== "revoked" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void rotate(principal)}
                      >
                        {t("rotateKey")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void setStatus(principal, "revoked")}
                      >
                        {t("revokeAgent")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {principal.keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-3 text-xs"
                  >
                    <span>
                      {key.name} · <bdi>{key.lookupPrefix}</bdi> · {t("expires")}{" "}
                      {key.expiresAt
                        ? format.dateTime(new Date(key.expiresAt), { dateStyle: "medium", timeStyle: "short" })
                        : t("never")}{" "}
                      · {t("lastUsed")}{" "}
                      {key.lastUsedAt
                        ? format.dateTime(new Date(key.lastUsedAt), { dateStyle: "medium", timeStyle: "short" })
                        : t("never")}
                    </span>
                    {!key.revokedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void revokeKey(key.id)}
                      >
                        {t("revokeKey")}
                      </Button>
                    ) : (
                      <span>{t("revoked")}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {secret ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("newKey")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-lg rounded-lg bg-background p-5 shadow-xl">
            <h2 className="font-semibold">{t("copyNow")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("shownOnce")}
            </p>
            <code className="mt-4 block break-all rounded-md bg-muted p-3 text-xs">
              {secret}
            </code>
            <Button className="mt-4" onClick={() => setSecret(null)}>
              {t("saved")}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
